import type { Locale } from "@/i18n/locales";

/**
 * Body measurement maths for the body-progress preview: deltas against a
 * chosen reference measurement plus the three derived ratios (WHtR, WHR, RFM).
 *
 * Everything here is pure so the visual components stay free of arithmetic and
 * the numbers can be unit tested without rendering an SVG.
 */

/** Where a value came from. Shown as a text badge, never as colour alone. */
export type MeasurementSource = "MANUAL" | "BIA" | "ESTIMATE" | "DERIVED";

export interface BodyMeasurement {
  date: string;
  weightKg: number;
  neckCm: number;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  upperArmLeftCm: number;
  upperArmRightCm: number;
  thighLeftCm: number;
  thighRightCm: number;
  calfLeftCm: number;
  calfRightCm: number;
  /** Composition is optional: a tape measure alone cannot produce it. */
  bodyFatPct: number | null;
  muscleKg: number | null;
  bodyWaterPct: number | null;
  boneKg: number | null;
  compositionSource: MeasurementSource | null;
}

export interface BodyProfile {
  heightCm: number;
  /** RFM uses a sex-specific constant; without it no estimate is shown. */
  sex: "male" | "female" | null;
  ageYears: number | null;
}

export type BodyMetricKey =
  | "weightKg"
  | "neckCm"
  | "chestCm"
  | "waistCm"
  | "hipCm"
  | "upperArmCm"
  | "thighCm"
  | "calfCm"
  | "bodyFatPct"
  | "muscleKg"
  | "bodyWaterPct"
  | "boneKg";

export interface BodyMetricDef {
  key: BodyMetricKey;
  /** Unit of the value itself. */
  unit: "kg" | "cm" | "%";
  /** Unit of a change. A change in a percentage is percentage points. */
  deltaUnit: "kg" | "cm" | "pp";
  digits: number;
  source: MeasurementSource;
}

export const BODY_METRICS: BodyMetricDef[] = [
  { key: "weightKg", unit: "kg", deltaUnit: "kg", digits: 1, source: "MANUAL" },
  { key: "neckCm", unit: "cm", deltaUnit: "cm", digits: 1, source: "MANUAL" },
  { key: "chestCm", unit: "cm", deltaUnit: "cm", digits: 1, source: "MANUAL" },
  { key: "waistCm", unit: "cm", deltaUnit: "cm", digits: 1, source: "MANUAL" },
  { key: "hipCm", unit: "cm", deltaUnit: "cm", digits: 1, source: "MANUAL" },
  { key: "upperArmCm", unit: "cm", deltaUnit: "cm", digits: 1, source: "MANUAL" },
  { key: "thighCm", unit: "cm", deltaUnit: "cm", digits: 1, source: "MANUAL" },
  { key: "calfCm", unit: "cm", deltaUnit: "cm", digits: 1, source: "MANUAL" },
  { key: "bodyFatPct", unit: "%", deltaUnit: "pp", digits: 1, source: "BIA" },
  { key: "muscleKg", unit: "kg", deltaUnit: "kg", digits: 1, source: "BIA" },
  { key: "bodyWaterPct", unit: "%", deltaUnit: "pp", digits: 1, source: "BIA" },
  { key: "boneKg", unit: "kg", deltaUnit: "kg", digits: 1, source: "DERIVED" },
];

export const BODY_METRIC_BY_KEY = new Map(BODY_METRICS.map((metric) => [metric.key, metric]));

/** Metrics offered as chips in the time-series card, in reading order. */
export const SERIES_METRICS: BodyMetricKey[] = [
  "waistCm",
  "weightKg",
  "hipCm",
  "chestCm",
  "upperArmCm",
  "thighCm",
  "bodyFatPct",
  "muscleKg",
];

/** Paired limbs are averaged for every summary view; both sides stay in the log. */
const mean = (left: number, right: number) => (left + right) / 2;

export function metricValue(measurement: BodyMeasurement, key: BodyMetricKey): number | null {
  switch (key) {
    case "upperArmCm":
      return mean(measurement.upperArmLeftCm, measurement.upperArmRightCm);
    case "thighCm":
      return mean(measurement.thighLeftCm, measurement.thighRightCm);
    case "calfCm":
      return mean(measurement.calfLeftCm, measurement.calfRightCm);
    default:
      return measurement[key];
  }
}

export function metricSource(measurement: BodyMeasurement, key: BodyMetricKey): MeasurementSource {
  const def = BODY_METRIC_BY_KEY.get(key);
  if (def && def.source !== "MANUAL" && measurement.compositionSource) {
    return key === "boneKg" ? "DERIVED" : measurement.compositionSource;
  }
  return def?.source ?? "MANUAL";
}

/* ------------------------------------------------------------------- Deltas */

export type DeltaDirection = "up" | "down" | "flat";

export interface Delta {
  absolute: number;
  /** Relative change in percent, or null when the reference is zero. */
  percent: number | null;
  direction: DeltaDirection;
}

/**
 * A change smaller than half of the displayed precision would render as "+0.0",
 * which reads as a change that is not there. Those count as unchanged.
 */
export function deltaBetween(current: number | null, reference: number | null, digits = 1): Delta | null {
  if (current == null || reference == null || !Number.isFinite(current) || !Number.isFinite(reference)) return null;
  const absolute = current - reference;
  const epsilon = 0.5 * 10 ** -digits;
  return {
    absolute,
    percent: reference === 0 ? null : (absolute / reference) * 100,
    direction: absolute > epsilon ? "up" : absolute < -epsilon ? "down" : "flat",
  };
}

export function metricDelta(
  current: BodyMeasurement,
  reference: BodyMeasurement,
  key: BodyMetricKey,
): Delta | null {
  const digits = BODY_METRIC_BY_KEY.get(key)?.digits ?? 1;
  return deltaBetween(metricValue(current, key), metricValue(reference, key), digits);
}

/* ------------------------------------------------------------------ Ratios */

/** Waist-to-height ratio. Both circumferences must share the same unit. */
export function waistToHeight(waistCm: number | null, heightCm: number | null): number | null {
  if (waistCm == null || heightCm == null || heightCm <= 0) return null;
  return waistCm / heightCm;
}

/** Waist-to-hip ratio. */
export function waistToHip(waistCm: number | null, hipCm: number | null): number | null {
  if (waistCm == null || hipCm == null || hipCm <= 0) return null;
  return waistCm / hipCm;
}

/**
 * Relative Fat Mass (Woolcock et al., 2018): an estimate from height, waist and
 * sex. It is validated for adults only, so no value is produced without a known
 * sex or for anyone under 18 — an unlabelled guess would be worse than a gap.
 */
export function relativeFatMass(profile: BodyProfile, waistCm: number | null): number | null {
  const { heightCm, sex, ageYears } = profile;
  if (sex == null || waistCm == null || waistCm <= 0 || heightCm <= 0) return null;
  if (ageYears == null || ageYears < 18) return null;
  const constant = sex === "female" ? 76 : 64;
  return constant - 20 * (heightCm / waistCm);
}

/* --------------------------------------------------------------- Formatting */

const cache = new Map<string, Intl.NumberFormat>();

/**
 * Fixed-precision formatting. Unlike the shared `formatNumber` this keeps the
 * trailing zero, because "±0.0 kg" states that a value was measured and did not
 * move, while "±0 kg" reads like a rounded placeholder.
 */
function fixed(locale: Locale, digits: number) {
  const key = `${locale}:${digits}`;
  let instance = cache.get(key);
  if (!instance) {
    instance = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    cache.set(key, instance);
  }
  return instance;
}

export const formatMeasure = (value: number, locale: Locale, digits = 1) => fixed(locale, digits).format(value);

/** Signed change with an explicit "no change" sign, so direction is never colour-only. */
export function formatDelta(value: number, locale: Locale, digits = 1) {
  const rounded = Number(value.toFixed(digits));
  const magnitude = fixed(locale, digits).format(Math.abs(rounded));
  if (rounded === 0) return `±${magnitude}`;
  return `${rounded > 0 ? "+" : "−"}${magnitude}`;
}

/* -------------------------------------------------------------- Series helpers */

/** Measurements are held oldest first; the newest one is the current state. */
export const latestIndex = (measurements: BodyMeasurement[]) => Math.max(measurements.length - 1, 0);

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Index of the measurement closest to `days` before `currentIndex`, never the
 * current one itself, so a quick choice always yields a usable comparison.
 */
export function indexNearestDaysBefore(
  measurements: BodyMeasurement[],
  currentIndex: number,
  days: number,
): number {
  const current = measurements[currentIndex];
  if (!current || currentIndex === 0) return 0;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < currentIndex; index += 1) {
    const distance = Math.abs(daysBetween(measurements[index].date, current.date) - days);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}
