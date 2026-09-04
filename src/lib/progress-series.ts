import {
  bodyMassIndex,
  daysBetween,
  metricValue,
  type BodyMeasurement,
  type BodyProfile,
  type BodySeriesMetricKey,
} from "./body-metrics";
import { NUTRIENTS } from "./nutrients";
import type { NutritionProgressPoint } from "./nutrition-progress";

/**
 * What the one progress chart can draw: a body measurement over time, a
 * nutrient's daily target attainment and the calories sport and activity added
 * to a day, side by side on the same time axis.
 *
 * Everything here is pure arithmetic over dates and numbers, so the component
 * stays a drawing and the rules about what may share a y-axis can be tested
 * without rendering an SVG.
 */

/** Nutrition offers three chips, each of which stands for a set of nutrients. */
export const NUTRITION_SERIES = ["calories", "macros", "micros"] as const;

export type NutritionSeriesKey = (typeof NUTRITION_SERIES)[number];

/**
 * What sport and activity added to a day, in kilocalories. It is neither a body
 * measurement nor a share of a target, so it is its own kind of chip.
 */
export const ACTIVITY_SERIES = "activity";

export type ActivitySeriesKey = typeof ACTIVITY_SERIES;

export type ProgressSeriesKey = BodySeriesMetricKey | NutritionSeriesKey | ActivitySeriesKey;

export const MACRO_KEYS = ["protein", "carbohydrate", "fat"];

const MICRO_CATEGORIES = new Set(["secondary", "mineral", "vitamin"]);

export const isNutritionSeries = (key: ProgressSeriesKey): key is NutritionSeriesKey =>
  (NUTRITION_SERIES as readonly string[]).includes(key);

export const isActivitySeries = (key: ProgressSeriesKey): key is ActivitySeriesKey => key === ACTIVITY_SERIES;

/**
 * Which scale a chip is drawn against. Each measurement gets its own: a weight
 * of 98 kg and a muscle mass of 38 kg share a unit but not a range, and one
 * axis spanning both would draw two flat lines and call it a history.
 *
 * Target attainment is the exception. Every nutrient on it is already a
 * percentage of its own goal, which is what makes them comparable, so they
 * share the one scale the 100 % line belongs to.
 */
export type AxisKey = BodySeriesMetricKey | "target" | "activeKcal";

export function axisOf(key: ProgressSeriesKey): AxisKey {
  if (isNutritionSeries(key)) return "target";
  if (isActivitySeries(key)) return "activeKcal";
  return key;
}

/**
 * How many chips can be on at once. Past this the chart is a thicket, and the
 * colours start repeating.
 */
export const MAX_SELECTED = 4;

/** The scales a selection needs, in the order the chips were switched on. */
export function axesFor(selection: readonly ProgressSeriesKey[]): AxisKey[] {
  const axes: AxisKey[] = [];
  for (const key of selection) {
    const axis = axisOf(key);
    if (!axes.includes(axis)) axes.push(axis);
  }
  return axes;
}

/**
 * Whether this chip is one too many. Such a chip is offered as unavailable
 * rather than silently dropped, so the limit is visible before it is hit.
 */
export function isOverLimit(selection: readonly ProgressSeriesKey[], key: ProgressSeriesKey): boolean {
  return !selection.includes(key) && selection.length >= MAX_SELECTED;
}

/**
 * Turning a chip on or off. The last remaining chip stays on: an empty chart
 * with a row of chips above it looks broken rather than empty.
 */
export function toggleSeries(selection: readonly ProgressSeriesKey[], key: ProgressSeriesKey): ProgressSeriesKey[] {
  if (selection.includes(key)) {
    return selection.length === 1 ? [...selection] : selection.filter((entry) => entry !== key);
  }
  if (isOverLimit(selection, key)) return [...selection];
  return [...selection, key];
}

/** Micronutrients this reader has a personal daily target for. */
export function availableMicros(points: NutritionProgressPoint[]): string[] {
  return NUTRIENTS.filter(
    (nutrient) => MICRO_CATEGORIES.has(nutrient.category) && points.some((point) => point.targets[nutrient.key]),
  ).map((nutrient) => nutrient.key);
}

/** One drawn line, before it is given a label and a colour. */
export interface SeriesPoint {
  date: string;
  value: number;
  /** Index into the measurement list, so a body point can become "current". */
  index: number | null;
}

export interface SeriesSource {
  /** Unique across the chart: a metric key, a nutrient key or the activity line. */
  id: string;
  /** The chip that put it on the chart. */
  chip: ProgressSeriesKey;
  axis: AxisKey;
  metric?: BodySeriesMetricKey;
  nutrient?: string;
  /** The active calories line, which has neither a metric nor a nutrient behind it. */
  activity?: true;
}

/**
 * The lines a selection stands for. A macro or micro chip is a set, so it
 * expands into one line per nutrient the reader kept switched on below it.
 */
export function expandSelection(
  selection: readonly ProgressSeriesKey[],
  macros: readonly string[],
  micros: readonly string[],
): SeriesSource[] {
  return selection.flatMap<SeriesSource>((chip) => {
    if (chip === "calories") return [{ id: "energyKcal", chip, axis: "target" as const, nutrient: "energyKcal" }];
    if (chip === "macros") return macros.map((key) => ({ id: key, chip, axis: "target" as const, nutrient: key }));
    if (chip === "micros") return micros.map((key) => ({ id: key, chip, axis: "target" as const, nutrient: key }));
    if (chip === ACTIVITY_SERIES) return [{ id: "activeKcal", chip, axis: "activeKcal" as const, activity: true as const }];
    return [{ id: chip, chip, axis: axisOf(chip), metric: chip }];
  });
}

export function bodySeriesPoints(
  measurements: BodyMeasurement[],
  metric: BodySeriesMetricKey,
  profile: BodyProfile | null,
): SeriesPoint[] {
  return measurements.flatMap((measurement, index) => {
    const value =
      metric === "bmi"
        ? bodyMassIndex(measurement.weightKg, profile?.heightCm ?? null)
        : metricValue(measurement, metric);
    return value == null ? [] : [{ date: measurement.date, value, index }];
  });
}

/** One day of recorded sport and activity, as the progress page aggregates it. */
export interface ActivityDayPoint {
  date: string;
  activeKcal: number;
}

export function activitySeriesPoints(points: ActivityDayPoint[]): SeriesPoint[] {
  return points.map((point) => ({ date: point.date, value: point.activeKcal, index: null }));
}

export function nutritionSeriesPoints(points: NutritionProgressPoint[], nutrient: string): SeriesPoint[] {
  return points.flatMap((point) => {
    const value = point.percentages[nutrient];
    return value == null ? [] : [{ date: point.date, value, index: null }];
  });
}

/** Keeps the points inside a chosen window, measured back from the newest data. */
export function withinRange(points: SeriesPoint[], lastDate: string | null, days: number | null): SeriesPoint[] {
  if (days == null || lastDate == null) return points;
  return points.filter((point) => daysBetween(point.date, lastDate) <= days);
}

export interface Scale {
  min: number;
  max: number;
}

/**
 * The scale for one axis. Target attainment is always read against 100 %, so it
 * starts at zero and keeps the target line inside the frame; active calories are
 * read against nothing at all, so they start there too; a measurement is read
 * against itself, so it gets a padded window around what was measured.
 */
export function axisScale(axis: AxisKey, values: number[], digits: number, goal: number | null = null): Scale | null {
  if (values.length === 0) return null;
  if (axis === "target") {
    return { min: 0, max: Math.max(125, Math.ceil((Math.max(...values, 100) + 10) / 25) * 25) };
  }
  /* Active calories are a count of what was burnt on a day, so the honest floor
     is zero: a padded window around the measured values would make a quiet week
     look like a hard one. */
  if (axis === "activeKcal") {
    return { min: 0, max: Math.max(Math.ceil((Math.max(...values) * 1.1) / 50) * 50, 50) };
  }
  const low = Math.min(...values, ...(goal == null ? [] : [goal]));
  const high = Math.max(...values, ...(goal == null ? [] : [goal]));
  const pad = Math.max((high - low) * 0.15, 10 ** -digits);
  return { min: low - pad, max: high + pad };
}

/** Trailing average over three sessions — the weekly analogue of the 7-day line. */
export function trailingAverage(values: number[], window = 3): (number | null)[] {
  return values.map((_unused, index) => {
    if (index + 1 < window) return null;
    const slice = values.slice(index + 1 - window, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / window;
  });
}
