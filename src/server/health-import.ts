import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  decideSample,
  type ExistingRecords,
  HEALTH_METRICS,
  type HealthMetric,
  type HealthPlatform,
  type HealthSample,
  lastPerDay,
  MEASUREMENT_COLUMN,
  type SampleDecision,
} from "@/lib/health-import";

/**
 * Writing side of a health import.
 *
 * The preview and the confirm run the same planner, and the planner asks
 * `decideSample` in `src/lib/health-import.ts` what to do with each sample. The
 * split is the usual one here: the rules are pure and tested exhaustively, and
 * this file is the part that knows how to read and write them.
 *
 * A preview that counted differently from what the import then did would be
 * worse than no preview at all, so there is exactly one place that decides.
 */

export interface PlannedSample {
  sample: HealthSample;
  decision: SampleDecision;
}

export interface MetricOutcome {
  metric: HealthMetric;
  create: number;
  update: number;
  skipManual: number;
  unchanged: number;
  firstDate: string | null;
  lastDate: string | null;
}

export interface ImportPlan {
  platform: HealthPlatform;
  planned: PlannedSample[];
  metrics: MetricOutcome[];
  /** Totals across every metric, which is what the confirm button counts. */
  totals: { create: number; update: number; skipManual: number; unchanged: number };
}

const decimal = (value: Prisma.Decimal | number | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const dayDate = (key: string) => new Date(`${key}T00:00:00.000Z`);

/** Read `BodyMeasurement.valueSources`, the per-value provenance map. */
const sourceMap = (valueSources: Prisma.JsonValue | null): Record<string, string | null> => {
  if (!valueSources || typeof valueSources !== "object" || Array.isArray(valueSources)) return {};
  const entries = Object.entries(valueSources as Record<string, unknown>);
  return Object.fromEntries(entries.map(([key, value]) => [key, typeof value === "string" ? value : null]));
};

/**
 * Decide what the import would do, without doing any of it.
 *
 * Everything a decision needs is read in four queries rather than one per
 * sample: an export covers years, and a per-sample round trip would make the
 * preview slower than the parse that produced it.
 */
export async function planImport(userId: string, platform: HealthPlatform, samples: HealthSample[]): Promise<ImportPlan> {
  // Defensive: the browser already collapses to one per day, but the planner
  // must not depend on a client having done so.
  const collapsed = lastPerDay(samples);
  const dates = [...new Set(collapsed.map((sample) => sample.date))].map(dayDate);
  const externalIds = collapsed.map((sample) => sample.externalId);

  const [imported, weights, measurements, profile] = await Promise.all([
    prisma.healthImportRecord.findMany({
      where: { userId, platform, externalId: { in: externalIds } },
      select: { externalId: true, value: true },
    }),
    prisma.weightEntry.findMany({ where: { userId, date: { in: dates } }, select: { date: true, weightKg: true, source: true } }),
    prisma.bodyMeasurement.findMany({
      where: { userId, date: { in: dates } },
      select: { date: true, bodyFatPct: true, waistCm: true, valueSources: true },
    }),
    prisma.userProfile.findUnique({ where: { userId }, select: { heightCm: true } }),
  ]);

  const existing: ExistingRecords = {
    importedValueByExternalId: new Map(imported.map((row) => [row.externalId, Number(row.value)])),
    weightByDate: new Map(weights.map((row) => [dayKey(row.date), { value: Number(row.weightKg), source: row.source }])),
    measurementByDate: new Map(
      measurements.map((row) => [
        dayKey(row.date),
        { bodyFatPct: decimal(row.bodyFatPct), waistCm: decimal(row.waistCm), sources: sourceMap(row.valueSources) },
      ]),
    ),
    profileHeightCm: decimal(profile?.heightCm),
  };

  const planned = collapsed.map((sample) => ({ sample, decision: decideSample(sample, existing) }));
  return { platform, planned, metrics: summariseMetrics(planned), totals: totalsOf(planned) };
}

function summariseMetrics(planned: PlannedSample[]): MetricOutcome[] {
  return HEALTH_METRICS.map((metric): MetricOutcome | null => {
    const forMetric = planned.filter((entry) => entry.sample.metric === metric);
    if (forMetric.length === 0) return null;

    const dates = forMetric.map((entry) => entry.sample.date).sort();
    const count = (decision: SampleDecision) => forMetric.filter((entry) => entry.decision === decision).length;

    return {
      metric,
      create: count("create"),
      update: count("update"),
      skipManual: count("skipManual"),
      unchanged: count("unchanged"),
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
    };
  }).filter((entry): entry is MetricOutcome => entry !== null);
}

const totalsOf = (planned: PlannedSample[]) => ({
  create: planned.filter((entry) => entry.decision === "create").length,
  update: planned.filter((entry) => entry.decision === "update").length,
  skipManual: planned.filter((entry) => entry.decision === "skipManual").length,
  unchanged: planned.filter((entry) => entry.decision === "unchanged").length,
});

/** Rows written per transaction. Years of daily history is thousands of them. */
const CHUNK = 200;

/**
 * Apply a plan.
 *
 * Chunked rather than one transaction, following the dataset importer: a single
 * transaction spanning a decade of history holds locks for as long as it takes
 * to write, and a partial import is recoverable here because re-running is
 * idempotent by construction - `HealthImportRecord` is what makes a second run
 * recognise whatever the first one managed to write.
 */
export async function applyImport(userId: string, platform: HealthPlatform, samples: HealthSample[]): Promise<ImportPlan> {
  const plan = await planImport(userId, platform, samples);
  const writable = plan.planned.filter((entry) => entry.decision === "create" || entry.decision === "update");

  for (let index = 0; index < writable.length; index += CHUNK) {
    const chunk = writable.slice(index, index + CHUNK);
    await prisma.$transaction(async (tx) => {
      for (const { sample } of chunk) await writeSample(tx, userId, platform, sample);
    });
  }

  return plan;
}

async function writeSample(tx: Prisma.TransactionClient, userId: string, platform: HealthPlatform, sample: HealthSample) {
  const date = dayDate(sample.date);

  switch (sample.metric) {
    case "weightKg":
      await tx.weightEntry.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, weightKg: sample.value, source: "HEALTH_PLATFORM" },
        update: { weightKg: sample.value, source: "HEALTH_PLATFORM" },
      });
      break;

    case "bodyFatPct":
    case "waistCm": {
      const column = MEASUREMENT_COLUMN[sample.metric];
      const existing = await tx.bodyMeasurement.findUnique({
        where: { userId_date: { userId, date } },
        select: { valueSources: true },
      });

      const valueSources = { ...sourceMap(existing?.valueSources ?? null), [column]: "HEALTH_PLATFORM" };
      /* `compositionSource` describes the composition block as a whole, so it is
         only claimed when this import is what put a composition value there. A
         waist circumference says nothing about it. */
      const composition = sample.metric === "bodyFatPct" ? { compositionSource: "HEALTH_PLATFORM" as const } : {};

      await tx.bodyMeasurement.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, [column]: sample.value, valueSources, ...composition },
        update: { [column]: sample.value, valueSources, ...composition },
      });
      break;
    }

    case "heightCm":
      await tx.userProfile.update({ where: { userId }, data: { heightCm: sample.value } });
      break;
  }

  await tx.healthImportRecord.upsert({
    where: { userId_platform_externalId: { userId, platform, externalId: sample.externalId } },
    create: { userId, platform, externalId: sample.externalId, metric: sample.metric, date, value: sample.value },
    update: { metric: sample.metric, date, value: sample.value, importedAt: new Date() },
  });
}
