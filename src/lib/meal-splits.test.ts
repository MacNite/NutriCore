import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEAL_SPLIT,
  MEAL_SPLIT_MEALS,
  MEAL_SPLIT_PRESETS,
  MEAL_SPLIT_PRESET_KEYS,
  isValidMealSplit,
  matchingPreset,
  mealTargets,
  splitTotal,
} from "./meal-splits";

const sum = (targets: Record<string, number> | null) => Object.values(targets ?? {}).reduce((total, value) => total + value, 0);

describe("presets", () => {
  it("every offered preset accounts for the whole day", () => {
    for (const key of MEAL_SPLIT_PRESET_KEYS) expect(splitTotal(MEAL_SPLIT_PRESETS[key])).toBe(100);
  });

  it("defaults to the classic 25/30/25/20 distribution", () => {
    expect(DEFAULT_MEAL_SPLIT).toEqual({ BREAKFAST: 25, LUNCH: 30, DINNER: 25, SNACKS: 20 });
    expect(matchingPreset(DEFAULT_MEAL_SPLIT)).toBe("classic");
  });

  it("reports no preset for a split the reader typed themselves", () => {
    expect(matchingPreset({ BREAKFAST: 26, LUNCH: 29, DINNER: 25, SNACKS: 20 })).toBeNull();
  });
});

describe("validation", () => {
  it("accepts a split that totals 100, including one that skips a meal", () => {
    expect(isValidMealSplit({ BREAKFAST: 30, LUNCH: 40, DINNER: 30, SNACKS: 0 })).toBe(true);
  });

  it("refuses a total that is not 100 rather than rescaling it", () => {
    expect(isValidMealSplit({ BREAKFAST: 25, LUNCH: 30, DINNER: 25, SNACKS: 19 })).toBe(false);
    expect(isValidMealSplit({ BREAKFAST: 25, LUNCH: 30, DINNER: 25, SNACKS: 21 })).toBe(false);
  });

  it("refuses negative and fractional shares", () => {
    expect(isValidMealSplit({ BREAKFAST: -10, LUNCH: 60, DINNER: 30, SNACKS: 20 })).toBe(false);
    expect(isValidMealSplit({ BREAKFAST: 25.5, LUNCH: 29.5, DINNER: 25, SNACKS: 20 })).toBe(false);
  });
});

describe("meal targets", () => {
  it("divides the day by the split", () => {
    expect(mealTargets(2000, DEFAULT_MEAL_SPLIT)).toEqual({ BREAKFAST: 500, LUNCH: 600, DINNER: 500, SNACKS: 400 });
  });

  it("always sums to exactly the daily target, whatever the rounding", () => {
    // 1990 split 25/30/25/20 is 497.5/597/497.5/398: rounding each on its own
    // gives 1991, one kcal the reader never had.
    const targets = mealTargets(1990, DEFAULT_MEAL_SPLIT);
    expect(sum(targets)).toBe(1990);
    expect(targets).toEqual({ BREAKFAST: 498, LUNCH: 597, DINNER: 497, SNACKS: 398 });
  });

  it("keeps the sum exact across a range of awkward targets and splits", () => {
    for (let kcal = 1200; kcal <= 3500; kcal += 7) {
      for (const key of MEAL_SPLIT_PRESET_KEYS) expect(sum(mealTargets(kcal, MEAL_SPLIT_PRESETS[key]))).toBe(kcal);
    }
  });

  it("never hands a rounding remainder to a meal that was given no budget", () => {
    const targets = mealTargets(1999, MEAL_SPLIT_PRESETS.noSnacks);
    expect(targets?.SNACKS).toBe(0);
    expect(sum(targets)).toBe(1999);
  });

  it("has no target to divide when the profile yields none", () => {
    expect(mealTargets(null, DEFAULT_MEAL_SPLIT)).toBeNull();
    expect(mealTargets(0, DEFAULT_MEAL_SPLIT)).toBeNull();
    expect(mealTargets(Number.NaN, DEFAULT_MEAL_SPLIT)).toBeNull();
  });

  it("refuses to divide by a split that does not add up", () => {
    expect(mealTargets(2000, { BREAKFAST: 25, LUNCH: 30, DINNER: 25, SNACKS: 10 })).toBeNull();
  });

  it("covers every meal the diary shows", () => {
    expect(Object.keys(mealTargets(2000, DEFAULT_MEAL_SPLIT) ?? {}).sort()).toEqual([...MEAL_SPLIT_MEALS].sort());
  });
});
