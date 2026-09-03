"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { REGION_FIELDS, SCAN_REGIONS, type ScanRegion } from "@/lib/body-scan";
import { jobPriority } from "./ai-types";
import { validateImageUpload, type ImageUploadError } from "./image-upload";
import { BODY_SCAN_CONSENT_VERSION, BODY_SCAN_IMAGE_TTL_MS } from "./body-scan";
import { requireUser } from "./session";
import type { FormState } from "./profile-actions";

/**
 * Writing side of body scanning.
 *
 * A capture creates a scan and a queued job, and nothing else: no measurement
 * is written here, and none is written by the worker either. The only path from
 * an estimate to a recorded value runs through `applyBodyScanAction` below,
 * which a person has to invoke by looking at the numbers and choosing them.
 */

const isFuture = (date: string) => date > new Date().toISOString().slice(0, 10);

const captureSchema = z.object({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "invalid-date" }),
  /* The same bounds the manual check-in uses, so a scan cannot record a body
     the form would have rejected. */
  heightCm: z.number().min(80).max(250),
  consent: z.literal("on", { message: "consent-required" }),
});

/**
 * Queues one scan from a front and a side capture.
 *
 * Height comes from the profile rather than the form: it is the scale for every
 * measurement, and a number typed next to the photographs is a number typed
 * once and forgotten. Someone with no height on file cannot scan at all, and is
 * told so rather than being given an estimate scaled by a guess.
 */
export async function startBodyScanAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();

  const limit = rateLimit(`body-scan:${user.id}`, RATE_LIMITS.bodyScan.limit, RATE_LIMITS.bodyScan.windowMs);
  if (!limit.allowed) return { error: "rateLimited" };

  const profile = await prisma.userProfile.findUnique({
    where: { userId: user.id },
    select: { heightCm: true },
  });
  if (!profile?.heightCm) return { error: "height-required" };

  const parsed = captureSchema.safeParse({
    date: formData.get("date") ?? "",
    heightCm: Number(profile.heightCm),
    consent: formData.get("consent") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message === "consent-required" ? "consent-required" : "validation" };
  }
  if (isFuture(parsed.data.date)) return { error: "validation" };

  let front, side;
  try {
    [front, side] = await Promise.all([
      validateImageUpload(formData.get("front")),
      validateImageUpload(formData.get("side")),
    ]);
  } catch (error) {
    return { error: (error instanceof Error ? error.message : "imageInvalid") as ImageUploadError };
  }
  if (!front || !side) return { error: "both-views-required" };

  const date = new Date(`${parsed.data.date}T00:00:00.000Z`);
  /* Recorded for provenance only. Nothing scales by it, but an estimate has to
     stay explainable by the numbers it was computed alongside. */
  const weight = await prisma.weightEntry.findUnique({
    where: { userId_date: { userId: user.id, date } },
    select: { weightKg: true },
  });

  const scan = await prisma.bodyScan.create({
    data: {
      userId: user.id,
      date,
      heightCm: parsed.data.heightCm,
      weightKg: weight?.weightKg ?? null,
      consentVersion: BODY_SCAN_CONSENT_VERSION,
      frontMime: front.mime,
      frontData: front.data,
      sideMime: side.mime,
      sideData: side.data,
      imagesExpireAt: new Date(Date.now() + BODY_SCAN_IMAGE_TTL_MS),
    },
    select: { id: true },
  });

  await prisma.aiJob.create({
    data: {
      userId: user.id,
      entityType: "BODY_SCAN",
      entityId: scan.id,
      priority: jobPriority("BODY_SCAN"),
      /* The images are read once and cleared with the result, so a second
         attempt has nothing to read. Failing once is failing. */
      maxRetries: 0,
    },
  });

  revalidatePath("/progress");
  redirect(`/body-scan/${scan.id}`);
}

const decisionSchema = z.object({
  scanId: z.string().min(1),
  accepted: z.array(z.enum(SCAN_REGIONS)),
  /**
   * Values the user changed before accepting, keyed by region.
   *
   * `partialRecord`, not `record`: a Zod 4 record with an enum key requires
   * every key of that enum to be present, so a review that edited one value
   * would have been rejected as invalid.
   */
  edits: z.partialRecord(z.enum(SCAN_REGIONS), z.number().min(5).max(250)),
});

/**
 * Merges the values a user accepted into that day's check-in.
 *
 * Three rules, all of them the reason this screen exists:
 *
 * - an estimate the user did not accept is not written, and the field keeps
 *   whatever it held;
 * - an accepted value never silently replaces a hand-measured one, so the
 *   existing value is only overwritten because the user ticked that region
 *   while looking at both numbers side by side;
 * - the estimate survives the decision. What the estimator said is kept on
 *   `BodyScanEstimate` whatever the user did with it, so a corrected value
 *   stays distinguishable from one that was simply accepted.
 */
export async function applyBodyScanAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();

  const accepted = SCAN_REGIONS.filter((region) => formData.get(`accept:${region}`) === "on");
  const edits: Partial<Record<ScanRegion, number>> = {};
  for (const region of accepted) {
    const raw = String(formData.get(`value:${region}`) ?? "").replace(",", ".");
    const value = Number(raw);
    if (raw !== "" && Number.isFinite(value)) edits[region] = value;
  }

  const parsed = decisionSchema.safeParse({
    scanId: formData.get("scanId") ?? "",
    accepted,
    edits,
  });
  if (!parsed.success) return { error: "validation" };

  const scan = await prisma.bodyScan.findFirst({
    where: { id: parsed.data.scanId, userId: user.id },
    include: { estimates: true },
  });
  if (!scan) return { error: "notFound" };
  if (scan.state !== "AWAITING_REVIEW") return { error: "already-reviewed" };

  const acceptedSet = new Set(parsed.data.accepted);
  const byRegion = new Map(scan.estimates.map((estimate) => [estimate.metricKey, estimate]));

  /* Nothing accepted is a decision too: the scan is rejected rather than left
     waiting for a review that already happened. */
  if (!acceptedSet.size) {
    await prisma.$transaction([
      prisma.bodyScanEstimate.updateMany({ where: { scanId: scan.id }, data: { decision: "REJECTED" } }),
      prisma.bodyScan.update({ where: { id: scan.id }, data: { state: "REJECTED", reviewedAt: new Date() } }),
    ]);
    revalidatePath("/progress");
    return { ok: true };
  }

  const values: Record<string, number> = {};
  const sources: Record<string, string> = {};
  for (const region of acceptedSet) {
    const estimate = byRegion.get(region);
    if (!estimate) continue;
    const value = parsed.data.edits[region] ?? Number(estimate.valueCm);
    for (const field of REGION_FIELDS[region]) {
      values[field] = value;
      /* An edited value is the user's own measurement, not the scan's. Recording
         it as MANUAL keeps the badge honest even though a scan prompted it. */
      sources[field] = parsed.data.edits[region] === undefined ? "OPTICAL_SCAN" : "MANUAL";
    }
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.bodyMeasurement.findUnique({
      where: { userId_date: { userId: user.id, date: scan.date } },
      select: { valueSources: true },
    });
    const priorSources = (existing?.valueSources ?? {}) as Record<string, string>;

    await tx.bodyMeasurement.upsert({
      where: { userId_date: { userId: user.id, date: scan.date } },
      create: { userId: user.id, date: scan.date, ...values, valueSources: sources },
      update: { ...values, valueSources: { ...priorSources, ...sources } },
    });

    for (const estimate of scan.estimates) {
      const region = estimate.metricKey as ScanRegion;
      const wasAccepted = acceptedSet.has(region);
      const edited = wasAccepted && parsed.data.edits[region] !== undefined;
      await tx.bodyScanEstimate.update({
        where: { id: estimate.id },
        data: {
          decision: !wasAccepted ? "REJECTED" : edited ? "EDITED" : "ACCEPTED",
          acceptedCm: edited ? parsed.data.edits[region] : wasAccepted ? estimate.valueCm : null,
        },
      });
    }

    await tx.bodyScan.update({
      where: { id: scan.id },
      data: { state: "ACCEPTED", reviewedAt: new Date() },
    });
  });

  revalidatePath("/progress");
  return { ok: true };
}

/**
 * Deletes a scan and everything derived from it.
 *
 * Measurements already merged into a check-in stay: they are the user's record
 * now, and silently removing values they accepted would be a worse surprise
 * than keeping them. The estimates and any remaining images go.
 */
export async function deleteBodyScanAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const scanId = String(formData.get("scanId") ?? "");
  if (!scanId) return;
  await prisma.bodyScan.deleteMany({ where: { id: scanId, userId: user.id } });
  revalidatePath("/progress");
}
