"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { HEALTH_PLATFORMS, type HealthPlatform } from "@/lib/health-import";
import { ingest, type IngestRejection, type IngestSample, parseSamples } from "./health-import-ingest";
import type { ImportPlan } from "./health-import";
import { requireUser } from "./session";

/**
 * Entry point for the import from the settings page, in two steps that share a
 * planner with each other and, since device sync exists, with the endpoint in
 * `src/app/api/health/samples/route.ts`. What a sample is and what happens to
 * it live in `./health-import-ingest`; what is left here is this path's own
 * question, which is who is signed in.
 *
 * The samples arrive as a plain array rather than a file: parsing happens in
 * the browser, so what reaches the server is only the handful of metrics it can
 * store. That is what keeps an 800 MB export inside a request limit derived
 * from the image upload policy - and it means the heart rate, sleep and
 * clinical records the same file holds never leave the phone.
 *
 * The array is still untrusted input. It is shaped by a page we serve, but a
 * server action is a public endpoint and nothing here may assume otherwise.
 */

export type ImportState =
  | { status: "idle" }
  | { status: "planned"; plan: ImportPlan }
  | { status: "imported"; plan: ImportPlan }
  | { status: "error"; error: IngestRejection | "rateLimited" };

/**
 * What the settings page sends. The platform travels with the payload here
 * because the browser has just read it out of the file it parsed; on the device
 * endpoint it comes from the token instead.
 */
const envelopeSchema = z.object({ platform: z.enum(HEALTH_PLATFORMS) });

export type ImportPayload = { platform: HealthPlatform; samples: IngestSample[] };

type Guarded =
  | { user: { id: string }; platform: HealthPlatform; samples: IngestSample[] }
  | { error: Extract<ImportState, { status: "error" }>["error"] };

async function guard(payload: unknown): Promise<Guarded> {
  const user = await requireUser();

  const limit = rateLimit(`healthImport:${user.id}`, RATE_LIMITS.healthImport.limit, RATE_LIMITS.healthImport.windowMs);
  if (!limit.allowed) return { error: "rateLimited" as const };

  /* The platform is read separately from the samples so a malformed platform
     cannot be reported as a sample problem, and so the sample check is the same
     call the endpoint makes. */
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) return { error: "validation" as const };

  const samples = parseSamples((payload as { samples?: unknown }).samples);
  if (!samples.ok) return { error: samples.error };

  return { user, platform: envelope.data.platform, samples: samples.samples };
}

/** Step one: say what would happen. Writes nothing. */
export async function previewHealthImportAction(payload: unknown): Promise<ImportState> {
  const checked = await guard(payload);
  if ("error" in checked) return { status: "error", error: checked.error };

  const plan = await ingest(checked.user.id, checked.platform, checked.samples, { dryRun: true });
  return { status: "planned", plan };
}

/** Step two: do it. Re-plans against the database as it stands now. */
export async function applyHealthImportAction(payload: unknown): Promise<ImportState> {
  const checked = await guard(payload);
  if ("error" in checked) return { status: "error", error: checked.error };

  const plan = await ingest(checked.user.id, checked.platform, checked.samples, { dryRun: false });

  revalidatePath("/progress");
  revalidatePath("/settings");
  revalidatePath("/");

  return { status: "imported", plan };
}
