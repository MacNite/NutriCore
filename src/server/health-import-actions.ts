"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { DATE_KEY_PATTERN } from "@/lib/date";
import { HEALTH_METRICS, HEALTH_PLATFORMS, MAX_IMPORT_SAMPLES, METRIC_RANGES, type HealthMetric } from "@/lib/health-import";
import { applyImport, planImport, type ImportPlan } from "./health-import";
import { requireUser } from "./session";

/**
 * Entry point for the import, in two steps that share a planner.
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
  | { status: "error"; error: "validation" | "tooMany" | "rateLimited" | "empty" };

const sampleSchema = z
  .object({
    metric: z.enum(HEALTH_METRICS),
    date: z.string().regex(DATE_KEY_PATTERN),
    recordedAt: z.string().datetime(),
    value: z.number().finite(),
    externalId: z.string().min(1).max(128),
    source: z.string().max(120).nullable(),
  })
  /* The range check is the same one the readers apply and the same one
     `saveBodyCheckinAction` applies to typed input. Repeating it here is not
     redundancy: the readers run in a browser we do not control. */
  .refine((sample) => {
    const range = METRIC_RANGES[sample.metric as HealthMetric];
    return sample.value >= range.min && sample.value <= range.max;
  });

const payloadSchema = z.object({
  platform: z.enum(HEALTH_PLATFORMS),
  samples: z.array(sampleSchema).max(MAX_IMPORT_SAMPLES),
});

export type ImportPayload = z.infer<typeof payloadSchema>;

type Guarded = { user: { id: string }; data: ImportPayload } | { error: Extract<ImportState, { status: "error" }>["error"] };

async function guard(payload: unknown): Promise<Guarded> {
  const user = await requireUser();

  const limit = rateLimit(`healthImport:${user.id}`, RATE_LIMITS.healthImport.limit, RATE_LIMITS.healthImport.windowMs);
  if (!limit.allowed) return { error: "rateLimited" as const };

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    // A payload over the cap is a different problem from a malformed one, and
    // the user can act on it: export a narrower range.
    const tooMany = parsed.error.issues.some((issue) => issue.code === "too_big");
    return { error: tooMany ? ("tooMany" as const) : ("validation" as const) };
  }
  if (parsed.data.samples.length === 0) return { error: "empty" as const };

  return { user, data: parsed.data };
}

/** Step one: say what would happen. Writes nothing. */
export async function previewHealthImportAction(payload: unknown): Promise<ImportState> {
  const checked = await guard(payload);
  if ("error" in checked) return { status: "error", error: checked.error };

  const plan = await planImport(checked.user.id, checked.data.platform, checked.data.samples);
  return { status: "planned", plan };
}

/** Step two: do it. Re-plans against the database as it stands now. */
export async function applyHealthImportAction(payload: unknown): Promise<ImportState> {
  const checked = await guard(payload);
  if ("error" in checked) return { status: "error", error: checked.error };

  const plan = await applyImport(checked.user.id, checked.data.platform, checked.data.samples);

  revalidatePath("/progress");
  revalidatePath("/settings");
  revalidatePath("/");

  return { status: "imported", plan };
}
