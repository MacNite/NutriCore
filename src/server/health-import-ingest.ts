import { z } from "zod";
import { prisma } from "@/lib/db";
import { DATE_KEY_PATTERN } from "@/lib/date";
import {
  HEALTH_METRICS,
  type HealthMetric,
  type HealthPlatform,
  MAX_IMPORT_SAMPLES,
  METRIC_RANGES,
} from "@/lib/health-import";
import { applyImport, planImport, type ImportPlan } from "./health-import";

/**
 * What every route into the importer agrees on.
 *
 * There are two of them now. The settings page parses a file in the browser and
 * posts the result to a Server Action; a phone syncing on its own posts the same
 * samples to `/api/health/samples` with a device token. They authenticate
 * differently and they always will, but what a sample is, how many may arrive at
 * once, and what happens to them afterwards must not diverge - a rule enforced
 * on one path and not the other is not a rule.
 *
 * So the schema and the write live here, and the two entry points are left with
 * nothing but their own idea of who is calling.
 */

/**
 * One sample, as untrusted input.
 *
 * The readers in `src/lib/` apply these same ranges before a sample is ever
 * offered to the user. Repeating them is not redundancy: those readers run on a
 * device we do not control, and both entry points here are public endpoints.
 */
export const sampleSchema = z
  .object({
    metric: z.enum(HEALTH_METRICS),
    date: z.string().regex(DATE_KEY_PATTERN),
    recordedAt: z.string().datetime(),
    value: z.number().finite(),
    externalId: z.string().min(1).max(128),
    source: z.string().max(120).nullable(),
  })
  .refine((sample) => {
    const range = METRIC_RANGES[sample.metric as HealthMetric];
    return sample.value >= range.min && sample.value <= range.max;
  });

export const samplesSchema = z.array(sampleSchema).max(MAX_IMPORT_SAMPLES);

/**
 * The largest request body the device endpoint will read.
 *
 * `MAX_IMPORT_SAMPLES` bounds the samples, but only after the body has been
 * parsed - and the sync route is one of the few the middleware does not match
 * (`api/health` is excluded from its matcher), so none of the body limits in
 * `next.config.ts` apply to it either. Without a ceiling of its own, a caller
 * holding a valid token could make the server buffer as much as it liked.
 *
 * The arithmetic: a sample serialises to roughly 200 bytes with a UUID for an
 * `externalId`, so a maximal legitimate payload is around 10 MB. This is well
 * clear of that and still bounded.
 *
 * It is checked against `Content-Length`, which a client sending a chunked body
 * does not provide. That case is left to the rate limit and to the fact that
 * the request is refused before its body is read unless the token is valid;
 * bounding it properly would mean streaming the parse, which is a great deal of
 * machinery for a self-hosted instance whose callers are its owner's phones.
 */
export const MAX_SYNC_BODY_BYTES = 16 * 1024 * 1024;

export type IngestSample = z.infer<typeof sampleSchema>;

/**
 * Why a payload was refused.
 *
 * `tooMany` is separate from `validation` because the caller can act on it -
 * export a narrower range, or send fewer days - and a single "bad request"
 * would leave them guessing.
 */
export type IngestRejection = "validation" | "tooMany" | "empty";

export type ParsedSamples = { ok: true; samples: IngestSample[] } | { ok: false; error: IngestRejection };

/** Validate an untrusted sample array. Shared by the action and the endpoint. */
export function parseSamples(value: unknown): ParsedSamples {
  const parsed = samplesSchema.safeParse(value);
  if (!parsed.success) {
    const tooMany = parsed.error.issues.some((issue) => issue.code === "too_big");
    return { ok: false, error: tooMany ? "tooMany" : "validation" };
  }
  if (parsed.data.length === 0) return { ok: false, error: "empty" };
  return { ok: true, samples: parsed.data };
}

/** Plan an import, or plan and perform it. One place, so a preview cannot lie. */
export function ingest(
  userId: string,
  platform: HealthPlatform,
  samples: IngestSample[],
  { dryRun }: { dryRun: boolean },
): Promise<ImportPlan> {
  return dryRun ? planImport(userId, platform, samples) : applyImport(userId, platform, samples);
}

/** The newest day already imported for one metric, and how many samples stand behind it. */
export interface MetricCursor {
  metric: HealthMetric;
  /** `YYYY-MM-DD`, or null when nothing has ever been imported for this metric. */
  latestDate: string | null;
  count: number;
}

/**
 * Where a device should resume from.
 *
 * A background sync that re-read the whole history every night would work - the
 * import is idempotent on `externalId` - and would also move years of samples
 * over a mobile connection to discover that none of them are new. This says
 * where to start instead.
 *
 * The date is the last day imported, not the day after it: a person who weighs
 * themselves in the morning and again at night produces two samples on one day,
 * and the second must not be missed because the first was already stored. A
 * client re-reads that day and the importer recognises what it has seen.
 *
 * The answer is per metric because they arrive from different devices at
 * different rates: a scale writes weight daily and height perhaps once.
 */
export async function syncCursor(userId: string, platform: HealthPlatform): Promise<MetricCursor[]> {
  const rows = await prisma.healthImportRecord.groupBy({
    by: ["metric"],
    where: { userId, platform },
    _max: { date: true },
    _count: { _all: true },
  });

  const byMetric = new Map(rows.map((row) => [row.metric, row]));

  return HEALTH_METRICS.map((metric) => {
    const row = byMetric.get(metric);
    return {
      metric,
      latestDate: row?._max.date ? row._max.date.toISOString().slice(0, 10) : null,
      count: row?._count._all ?? 0,
    };
  });
}
