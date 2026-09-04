import { describe, expect, it } from "vitest";
import { emptyMeasurement, type BodyMeasurement, type BodyProfile } from "./body-metrics";
import {
  activitySeriesPoints,
  axesFor,
  axisOf,
  axisScale,
  bodySeriesPoints,
  expandSelection,
  isOverLimit,
  nutritionSeriesPoints,
  toggleSeries,
  trailingAverage,
  withinRange,
  type ProgressSeriesKey,
} from "./progress-series";
import type { NutritionProgressPoint } from "./nutrition-progress";

const profile: BodyProfile = { heightCm: 180, sex: "male", ageYears: 40, targetWeightKg: 80 };

const session = (date: string, values: Partial<BodyMeasurement>): BodyMeasurement => ({
  ...emptyMeasurement(date),
  ...values,
});

const day = (date: string, percentages: Record<string, number | null>): NutritionProgressPoint => ({
  date,
  values: {},
  targets: {},
  coverage: {},
  percentages,
});

describe("progress series axes", () => {
  it("gives every measurement its own scale, and target attainment one shared scale", () => {
    expect(axisOf("weightKg")).toBe("weightKg");
    expect(axisOf("muscleKg")).toBe("muscleKg");
    expect(axisOf("bmi")).toBe("bmi");
    expect(axisOf("calories")).toBe("target");
    expect(axisOf("activity")).toBe("activeKcal");
    expect(axisOf("macros")).toBe("target");
    expect(axisOf("micros")).toBe("target");
  });

  it("does not let a weight and a muscle mass flatten each other onto one kilogram scale", () => {
    expect(axesFor(["weightKg", "muscleKg", "bmi"])).toEqual(["weightKg", "muscleKg", "bmi"]);
    expect(axesFor(["calories", "macros"])).toEqual(["target"]);
  });

  it("refuses a fifth chip but keeps the ones already on", () => {
    const selection: ProgressSeriesKey[] = ["weightKg", "bmi", "muscleKg", "waistCm"];
    expect(isOverLimit(selection, "hipCm")).toBe(true);
    expect(isOverLimit(selection, "weightKg")).toBe(false);
    expect(isOverLimit(["weightKg", "bmi"], "muscleKg")).toBe(false);
    expect(toggleSeries(selection, "hipCm")).toEqual(selection);
    expect(toggleSeries(["weightKg", "bmi"], "muscleKg")).toEqual(["weightKg", "bmi", "muscleKg"]);
  });

  it("keeps the last chip switched on so the chart is never chipless and empty", () => {
    expect(toggleSeries(["weightKg"], "weightKg")).toEqual(["weightKg"]);
    expect(toggleSeries(["weightKg", "bmi"], "weightKg")).toEqual(["bmi"]);
  });
});

describe("progress series expansion", () => {
  it("expands a nutrient group into one line per nutrient still switched on", () => {
    expect(expandSelection(["weightKg", "macros"], ["protein", "fat"], [])).toEqual([
      { id: "weightKg", chip: "weightKg", axis: "weightKg", metric: "weightKg" },
      { id: "protein", chip: "macros", axis: "target", nutrient: "protein" },
      { id: "fat", chip: "macros", axis: "target", nutrient: "fat" },
    ]);
  });

  it("draws sport and activity as one line on its own scale", () => {
    expect(expandSelection(["activity"], [], [])).toEqual([
      { id: "activeKcal", chip: "activity", axis: "activeKcal", activity: true },
    ]);
    expect(axesFor(["weightKg", "calories", "activity"])).toEqual(["weightKg", "target", "activeKcal"]);
    expect(
      activitySeriesPoints([
        { date: "2026-09-01", activeKcal: 320 },
        { date: "2026-09-02", activeKcal: 0 },
      ]),
    ).toEqual([
      { date: "2026-09-01", value: 320, index: null },
      { date: "2026-09-02", value: 0, index: null },
    ]);
  });

  it("drops sessions and days that measured nothing for the metric", () => {
    const measurements = [
      session("2026-08-30", { weightKg: 100 }),
      session("2026-08-31", {}),
      session("2026-09-01", { weightKg: 98 }),
    ];
    expect(bodySeriesPoints(measurements, "weightKg", profile)).toEqual([
      { date: "2026-08-30", value: 100, index: 0 },
      { date: "2026-09-01", value: 98, index: 2 },
    ]);
    expect(bodySeriesPoints(measurements, "bmi", profile).map((point) => point.value.toFixed(1))).toEqual(["30.9", "30.2"]);
    expect(nutritionSeriesPoints([day("2026-09-01", { protein: 92 }), day("2026-09-02", { protein: null })], "protein")).toEqual([
      { date: "2026-09-01", value: 92, index: null },
    ]);
  });

  it("measures the chosen window back from the newest data of any kind", () => {
    const points = [
      { date: "2026-06-01", value: 1, index: 0 },
      { date: "2026-08-25", value: 2, index: 1 },
    ];
    expect(withinRange(points, "2026-09-01", 31)).toEqual([points[1]]);
    expect(withinRange(points, "2026-09-01", null)).toEqual(points);
  });
});

describe("progress series scales", () => {
  it("reads target attainment against 100 % and keeps the target line in frame", () => {
    expect(axisScale("target", [40, 60], 0)).toEqual({ min: 0, max: 125 });
    expect(axisScale("target", [40, 190], 0)).toEqual({ min: 0, max: 200 });
  });

  it("pads a measurement scale around what was measured, and around the goal", () => {
    expect(axisScale("weightKg", [98, 100], 1)).toEqual({ min: 97.7, max: 100.3 });
    const withGoal = axisScale("weightKg", [98, 100], 1, 80)!;
    expect(withGoal.min).toBeLessThan(80);
    expect(withGoal.max).toBeGreaterThan(100);
  });

  it("reads active calories against zero, with headroom above the hardest day", () => {
    expect(axisScale("activeKcal", [120, 480], 0)).toEqual({ min: 0, max: 550 });
    /* A day of nothing must not collapse the scale onto the axis. */
    expect(axisScale("activeKcal", [0], 0)).toEqual({ min: 0, max: 50 });
  });

  it("still yields a readable window when every value is identical", () => {
    const scale = axisScale("weightKg", [98, 98], 1)!;
    expect(scale.max).toBeGreaterThan(scale.min);
  });

  it("has no scale without values", () => {
    expect(axisScale("weightKg", [], 1)).toBeNull();
  });
});

describe("trailing average", () => {
  it("only reports once the window is full", () => {
    expect(trailingAverage([1, 2, 3, 4])).toEqual([null, null, 2, 3]);
  });
});
