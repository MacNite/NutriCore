import { NUTRIENT_BY_KEY } from "./nutrients";
import { sumWithCoverage, type Nutrients } from "./nutrition";

export interface ProgressTarget {
  validFrom: string;
  values: Nutrients;
}

export interface NutritionProgressPoint {
  date: string;
  values: Nutrients;
  targets: Nutrients;
  percentages: Nutrients;
  coverage: Record<string, number | null>;
}

export function percentageOfTarget(consumed: number | null | undefined, target: number | null | undefined) {
  if (consumed == null || target == null || !Number.isFinite(consumed) || !Number.isFinite(target) || target <= 0) return null;
  return (consumed / target) * 100;
}

/** Selects the target that was active on the diary date, rather than applying today's goal to history. */
export function targetForDate(targets: ProgressTarget[], date: string): ProgressTarget | null {
  return [...targets]
    .filter((target) => target.validFrom.slice(0, 10) <= date)
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] ?? null;
}

export function aggregateNutritionDay(
  date: string,
  entries: { amount: number; nutrients: Nutrients }[],
  targets: ProgressTarget[],
): NutritionProgressPoint | null {
  if (entries.length === 0) return null;
  const keys = [...NUTRIENT_BY_KEY.keys()];
  const { known, coverage } = sumWithCoverage(entries, keys);
  const target = targetForDate(targets, date)?.values ?? {};
  return {
    date,
    values: known,
    targets: target,
    coverage,
    percentages: Object.fromEntries(keys.map((key) => [key, percentageOfTarget(known[key], target[key])])),
  };
}

