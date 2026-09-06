/**
 * The one shape every health export is reduced to.
 *
 * Apple writes XML, Health Connect writes an SQLite database, and neither
 * format resembles the other. Both readers therefore stop at `HealthSample`,
 * and everything downstream - the day rules, the preview, the writing - knows
 * only this shape. A third format later is a new reader and nothing else.
 *
 * Parsing happens in the browser. An Apple `export.xml` is routinely hundreds
 * of megabytes and holds heart rate, sleep, workouts and clinical records; the
 * four metrics below are a rounding error inside it. Reducing on the device
 * means the request stays small enough for the body limits this application
 * already sets, and - the better reason - the rest of somebody's medical
 * history never reaches the server at all.
 */

/**
 * What NutriCore can actually store. Everything else in an export is skipped.
 *
 * Muscle mass is deliberately absent. Both platforms offer lean body mass -
 * `HKQuantityTypeIdentifierLeanBodyMass` and `LeanBodyMassRecord` - and it is
 * not the same quantity as `BodyMeasurement.muscleKg`: lean mass counts bone,
 * organs and body water alongside muscle, so it reads several kilograms high.
 * Writing one into the other would put a number in the muscle column that no
 * device ever measured, which is the kind of quiet lie the rest of this schema
 * exists to prevent. It stays out until a source reports muscle mass as such.
 */
export const HEALTH_METRICS = ["weightKg", "bodyFatPct", "heightCm", "waistCm"] as const;
export type HealthMetric = (typeof HEALTH_METRICS)[number];

export const HEALTH_PLATFORMS = ["APPLE_HEALTH", "HEALTH_CONNECT"] as const;
export type HealthPlatform = (typeof HEALTH_PLATFORMS)[number];

export interface HealthSample {
  metric: HealthMetric;
  /**
   * The calendar day the sample belongs to, as the device that wrote it saw it.
   *
   * Decided during parsing, from the UTC offset the export itself carries,
   * because the server has no idea what timezone anyone is in - `UserProfile`
   * holds no such field and `src/lib/date.ts` treats a date as an opaque
   * `YYYY-MM-DD` key supplied by the client. Keeping that contract is what stops
   * this feature needing a second, disagreeing answer to "what day is it".
   */
  date: string;
  /** Instant it was recorded, ISO 8601. Used only to order samples within a day. */
  recordedAt: string;
  value: number;
  /**
   * Stable identity for one sample, so a re-import updates rather than duplicates.
   *
   * Health Connect rows carry their own UUID. Apple's export carries none, so
   * the reader derives one from the record's own fields; re-exporting the same
   * history yields the same id, which is the property that matters.
   */
  externalId: string;
  /** The app or device that wrote it. Shown to the user, never trusted. */
  source: string | null;
}

/**
 * Plausible ranges, matching the ones `saveBodyCheckinAction` enforces on typed
 * input. An export is not more trustworthy than a person, and a scale that
 * reports 0 kg during a firmware fault should be dropped here rather than
 * charted.
 */
export const METRIC_RANGES: Record<HealthMetric, { min: number; max: number }> = {
  weightKg: { min: 20, max: 400 },
  bodyFatPct: { min: 1, max: 80 },
  heightCm: { min: 50, max: 260 },
  waistCm: { min: 30, max: 250 },
};

export const inRange = (metric: HealthMetric, value: number) =>
  Number.isFinite(value) && value >= METRIC_RANGES[metric].min && value <= METRIC_RANGES[metric].max;

/**
 * The largest payload the confirm step will send.
 *
 * Samples are collapsed to one per metric per day before they leave the browser,
 * so this is about 34 years of complete daily history across all four metrics -
 * far past any real export, and small enough to stay well inside the Server
 * Action body limit that `next.config.ts` derives from the image upload policy.
 */
export const MAX_IMPORT_SAMPLES = 50_000;

const LB_TO_KG = 0.45359237;
const STONE_TO_KG = 6.35029318;
const INCH_TO_CM = 2.54;

/**
 * Mass in kilograms, whatever the export chose to write.
 *
 * Apple exports in the reader's own unit preference, so the same history is kg
 * for one person and lb for another. Returning null for an unrecognised unit is
 * deliberate: guessing that an unknown unit means kilograms is how a 168 lb
 * person becomes 168 kg.
 */
export function massToKg(value: number, unit: string): number | null {
  switch (unit.trim().toLowerCase()) {
    case "kg":
      return value;
    case "g":
      return value / 1000;
    case "lb":
    case "lbs":
      return value * LB_TO_KG;
    case "st":
    case "stone":
      return value * STONE_TO_KG;
    default:
      return null;
  }
}

/** Length in centimetres, on the same terms. */
export function lengthToCm(value: number, unit: string): number | null {
  switch (unit.trim().toLowerCase()) {
    case "cm":
      return value;
    case "m":
      return value * 100;
    case "mm":
      return value / 10;
    case "in":
    case "inch":
      return value * INCH_TO_CM;
    case "ft":
      return value * 12 * INCH_TO_CM;
    default:
      return null;
  }
}

/**
 * A body-fat reading as a percentage.
 *
 * HealthKit's percent unit is a fraction, and exports have been seen both ways -
 * `0.23` and `23`. The range decides, and it can: nobody has 0.23 % body fat and
 * nobody has 2300 %, so a value at or below 1 is a fraction and anything above
 * it is already a percentage. This is a heuristic, and it is the only one in
 * this file; it is here rather than in the Apple reader because Health Connect
 * has exactly the same ambiguity.
 */
export function percentToPct(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const pct = value <= 1 ? value * 100 : value;
  return inRange("bodyFatPct", pct) ? pct : null;
}

/**
 * The calendar day an instant falls on, at a given UTC offset in minutes.
 *
 * Both export formats state the offset their timestamps were written at, which
 * is the only reason this can be done without knowing the user's timezone.
 */
export function localDateKey(instantMs: number, offsetMinutes: number): string {
  return new Date(instantMs + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/**
 * One sample per metric per day: the last one recorded.
 *
 * A day holds one weight in this application (`WeightEntry` is unique on user
 * and date) and a health store holds as many as the scale was stood on. The
 * last reading of the day is the one a person would quote, and picking it here -
 * before anything is sent - is what keeps the payload proportional to days
 * rather than to how often somebody weighs themselves.
 *
 * Ties on the same instant are broken by external id so the result does not
 * depend on the order the file happened to be read in.
 */
export function lastPerDay(samples: HealthSample[]): HealthSample[] {
  const best = new Map<string, HealthSample>();
  for (const sample of samples) {
    const key = `${sample.metric}\0${sample.date}`;
    const held = best.get(key);
    if (!held || sample.recordedAt > held.recordedAt || (sample.recordedAt === held.recordedAt && sample.externalId > held.externalId)) {
      best.set(key, sample);
    }
  }
  return [...best.values()].sort((a, b) => a.date.localeCompare(b.date) || a.metric.localeCompare(b.metric));
}

/**
 * A short, stable id for a record that does not carry one.
 *
 * FNV-1a over the fields that identify a sample. It is not a security hash and
 * is not used as one: the only property required is that the same record in the
 * same export always yields the same string, so a second import recognises what
 * it already wrote. 64 bits keeps a decade of daily readings clear of a
 * collision while costing a fraction of what the full field text would add to
 * the payload.
 */
export function stableId(parts: readonly (string | number)[]): string {
  let hi = 0x811c9dc5;
  let lo = 0x1000193;
  const text = parts.join("\0");
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    hi = Math.imul(hi ^ code, 0x01000193) >>> 0;
    lo = Math.imul(lo ^ (code + i), 0x01000193) >>> 0;
  }
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

/** What will happen to one sample, decided before anything is written. */
export type SampleDecision = "create" | "update" | "skipManual" | "unchanged";

/**
 * The state an import decision depends on, read out of the database and handed
 * here as plain values.
 *
 * The rules live in this file rather than beside the queries because they are
 * the part worth testing exhaustively, and because a preview and a write that
 * consulted two different copies of them would be worse than having no preview.
 */
export interface ExistingRecords {
  /** Weight already recorded on a day, keyed `YYYY-MM-DD`, with its provenance. */
  weightByDate: Map<string, { value: number; source: string }>;
  /** Body measurement columns already recorded on a day, with per-value provenance. */
  measurementByDate: Map<string, { bodyFatPct: number | null; waistCm: number | null; sources: Record<string, string | null> }>;
  /** Height stated on the profile, if any. */
  profileHeightCm: number | null;
  /** Value this instance last imported for a sample identity. */
  importedValueByExternalId: Map<string, number>;
}

/** Which `BodyMeasurement` column a metric lands in, for the metrics that land there. */
export const MEASUREMENT_COLUMN = { bodyFatPct: "bodyFatPct", waistCm: "waistCm" } as const;

/**
 * Whether a recorded value is one a person put there.
 *
 * A field absent from `BodyMeasurement.valueSources` was entered by hand - that
 * is the schema's own rule, and it is what makes every row recorded before
 * importing existed count as manual without a backfill.
 */
export const isManualSource = (source: string | null | undefined) => source === null || source === undefined || source === "MANUAL";

/**
 * What an import would do with one sample.
 *
 * The rule in one sentence: a value somebody typed is never overwritten by a
 * file. It is the same rule the body-scan review follows - a number a person
 * stands behind outranks one a device produced - and it is the reason
 * `WeightEntry.source` had to exist before any of this could.
 */
export function decideSample(sample: HealthSample, existing: ExistingRecords): SampleDecision {
  const lastImported = existing.importedValueByExternalId.get(sample.externalId);

  switch (sample.metric) {
    case "weightKg": {
      const recorded = existing.weightByDate.get(sample.date);
      if (!recorded) return "create";
      if (recorded.source !== "HEALTH_PLATFORM") return "skipManual";
      return recorded.value === sample.value && lastImported === sample.value ? "unchanged" : "update";
    }

    case "bodyFatPct":
    case "waistCm": {
      const column = MEASUREMENT_COLUMN[sample.metric];
      const recorded = existing.measurementByDate.get(sample.date);
      if (!recorded) return "create";

      const value = recorded[column];
      // A day with a measurement session but nothing in this column is still a
      // day this value can be added to.
      if (value === null) return "create";
      if (isManualSource(recorded.sources[column])) return "skipManual";
      return value === sample.value && lastImported === sample.value ? "unchanged" : "update";
    }

    case "heightCm":
      /* Height is one value on the profile, not a dated record, and a person
         states their own. A file may fill it in when it is missing and may
         never argue with it once it is set. */
      return existing.profileHeightCm === null ? "create" : "skipManual";
  }
}

export interface MetricSummary {
  metric: HealthMetric;
  count: number;
  firstDate: string;
  lastDate: string;
}

export interface ImportSummary {
  total: number;
  metrics: MetricSummary[];
  sources: string[];
}

/** What the preview screen says about a file, computed without touching the database. */
export function summarise(samples: HealthSample[]): ImportSummary {
  const byMetric = new Map<HealthMetric, MetricSummary>();
  const sources = new Set<string>();

  for (const sample of samples) {
    if (sample.source) sources.add(sample.source);
    const held = byMetric.get(sample.metric);
    if (!held) {
      byMetric.set(sample.metric, { metric: sample.metric, count: 1, firstDate: sample.date, lastDate: sample.date });
      continue;
    }
    held.count += 1;
    if (sample.date < held.firstDate) held.firstDate = sample.date;
    if (sample.date > held.lastDate) held.lastDate = sample.date;
  }

  return {
    total: samples.length,
    metrics: HEALTH_METRICS.map((metric) => byMetric.get(metric)).filter((entry): entry is MetricSummary => entry !== undefined),
    sources: [...sources].sort(),
  };
}
