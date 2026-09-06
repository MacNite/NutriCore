"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { EDITABLE_KEYS } from "@/lib/nutrients";
import { requireAdmin, requireUser } from "./session";
import { FoodReportError, decideFoodReport, submitFoodReport } from "./food-reports";
import { validateReferenceUrl } from "./research";
import type { FormState } from "./profile-actions";

/**
 * The two ends of a food report: filing one, and deciding it.
 *
 * As everywhere else, the session is resolved and the caller authorised here,
 * and the service below takes a user id and trusts it. Deciding is
 * `requireAdmin` rather than an ownership check because a report only ever
 * concerns a food nobody owns - `submitFoodReport` refuses anything else - so
 * there is no second reviewer to be.
 */

/** An empty field is "no opinion", never a proposed zero. */
const optionalNumber = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : Number(value.replace(",", "."))))
  .refine((value) => value === null || (Number.isFinite(value) && value >= 0 && value <= 1_000_000), {
    message: "invalid",
  });

const reportSchema = z.object({
  foodId: z.string().min(1),
  comment: z.string().trim().max(2000),
  sourceUrl: z.string().trim().max(2000),
  servingSize: optionalNumber,
});

export async function reportFoodAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  /* A report is written into shared data by an ordinary member, which makes it
     the one food operation worth pacing. Generous enough that somebody working
     through a shelf of badly scanned products never trips it. */
  const limit = rateLimit(`food-report:${user.id}`, RATE_LIMITS.foodReport.limit, RATE_LIMITS.foodReport.windowMs);
  if (!limit.allowed) return { error: "rateLimited" };

  const parsed = reportSchema.safeParse({
    foodId: formData.get("foodId"),
    comment: formData.get("comment") ?? "",
    sourceUrl: formData.get("sourceUrl") ?? "",
    servingSize: formData.get("servingSize") ?? "",
  });
  if (!parsed.success) return { error: "validation" };

  const sourceUrl = validateReferenceUrl(parsed.data.sourceUrl);
  if (parsed.data.sourceUrl && !sourceUrl) return { error: "validation" };

  const values = EDITABLE_KEYS.flatMap((key) => {
    const raw = String(formData.get(`n_${key}`) ?? "").trim();
    if (raw === "") return [];
    const value = Number(raw.replace(",", "."));
    return Number.isFinite(value) && value >= 0 ? [{ nutrientKey: key, value }] : [];
  });

  try {
    await submitFoodReport(user.id, parsed.data.foodId, {
      comment: parsed.data.comment,
      sourceUrl,
      servingSize: parsed.data.servingSize,
      values,
    });
  } catch (error) {
    if (error instanceof FoodReportError) return { error: `report.${error.reason}` };
    throw error;
  }

  revalidatePath(`/foods/${parsed.data.foodId}`);
  revalidatePath("/admin");
  return { ok: true };
}

const decisionSchema = z.object({
  reportId: z.string().min(1),
  /** Every value the queue showed, ticked or not. */
  offered: z.array(z.string().min(1)).max(200).default([]),
  accept: z.array(z.string().min(1)).max(200).default([]),
  note: z.string().trim().max(2000).default(""),
  servingOffered: z.boolean(),
  servingAccepted: z.boolean(),
});

export async function decideFoodReportAction(formData: FormData) {
  const reviewer = await requireAdmin();

  const parsed = decisionSchema.safeParse({
    reportId: String(formData.get("reportId") ?? ""),
    offered: formData.getAll("offered").map(String),
    accept: formData.getAll("accept").map(String),
    note: String(formData.get("note") ?? ""),
    servingOffered: formData.getAll("servingOffered").length > 0,
    servingAccepted: String(formData.get("serving") ?? "") === "ACCEPT",
  });
  if (!parsed.success) return;

  // "Reject the report" is the same submission with nothing accepted, so one
  // decision path covers both buttons and there is no second way to end a
  // report that could disagree with this one.
  const rejectAll = String(formData.get("decision") ?? "") === "reject";

  /* An unticked checkbox posts nothing, so a refusal is the absence of a tick
     against the ids the form did offer - never an empty list, which would let a
     stale or truncated post silently refuse everything. */
  const ticked = rejectAll ? [] : parsed.data.accept.filter((id) => parsed.data.offered.includes(id));
  const accept = ticked.flatMap((id) => {
    // The number in the row's own field, so a reviewer can correct the
    // correction. A field left empty or spoiled falls back to nothing at all
    // rather than to a zero.
    const raw = String(formData.get(`value_${id}`) ?? "").trim();
    const value = Number(raw.replace(",", "."));
    return raw !== "" && Number.isFinite(value) && value >= 0 ? [{ id, value }] : [];
  });
  const accepted = new Set(accept.map((value) => value.id));
  const reject = parsed.data.offered.filter((id) => !accepted.has(id));

  const servingRaw = String(formData.get("servingValue") ?? "").trim();
  const servingValue = Number(servingRaw.replace(",", "."));

  const outcome = await decideFoodReport(parsed.data.reportId, reviewer.id, {
    accept,
    reject,
    note: parsed.data.note,
    ...(parsed.data.servingOffered
      ? {
          serving: !rejectAll && parsed.data.servingAccepted ? ("ACCEPT" as const) : ("REJECT" as const),
          ...(servingRaw !== "" && Number.isFinite(servingValue) && servingValue > 0 ? { servingValue } : {}),
        }
      : {}),
  });

  revalidatePath("/admin");
  if (outcome.foodId) revalidatePath(`/foods/${outcome.foodId}`);
}
