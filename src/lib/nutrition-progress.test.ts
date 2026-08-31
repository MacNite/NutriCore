import { describe, expect, it } from "vitest";
import { aggregateNutritionDay, percentageOfTarget, targetForDate } from "./nutrition-progress";

const targets = [{
  validFrom: "2026-01-01",
  values: { energyKcal: 2400, protein: 150, carbohydrate: 250, fat: 80, vitaminC: 95 },
}];

describe("nutrition progress", () => {
  it("calculates percentages without clamping values above 100%", () => {
    expect(percentageOfTarget(2000, 2400)).toBeCloseTo(83.333);
    expect(percentageOfTarget(150, 100)).toBe(150);
  });

  it("returns unknown for missing, invalid, and zero targets", () => {
    expect(percentageOfTarget(10, null)).toBeNull();
    expect(percentageOfTarget(null, 10)).toBeNull();
    expect(percentageOfTarget(10, 0)).toBeNull();
  });

  it("aggregates calories, macros, and configured micronutrients", () => {
    const point = aggregateNutritionDay("2026-08-31", [
      { amount: 100, nutrients: { energyKcal: 800, protein: 50, carbohydrate: 100, fat: 20, vitaminC: 50 } },
      { amount: 200, nutrients: { energyKcal: 1200, protein: 88, carbohydrate: 162.5, fat: 42.4, vitaminC: 60 } },
    ], targets)!;
    expect(point.values).toMatchObject({ energyKcal: 2000, protein: 138, carbohydrate: 262.5, fat: 62.4, vitaminC: 110 });
    expect(point.percentages).toMatchObject({ protein: 92, carbohydrate: 105, fat: 78, vitaminC: expect.closeTo(115.789) });
  });

  it("preserves incomplete coverage instead of presenting missing nutrients as zero", () => {
    const point = aggregateNutritionDay("2026-08-31", [
      { amount: 100, nutrients: { protein: 10, vitaminC: null } },
      { amount: 100, nutrients: { protein: 20, vitaminC: 40 } },
    ], targets)!;
    expect(point.values.vitaminC).toBe(40);
    expect(point.coverage.vitaminC).toBe(0.5);
  });

  it("uses the target active on each historical date and handles empty days", () => {
    expect(targetForDate([...targets, { validFrom: "2026-09-01", values: { protein: 180 } }], "2026-08-31")?.values.protein).toBe(150);
    expect(aggregateNutritionDay("2026-08-31", [], targets)).toBeNull();
  });
});
