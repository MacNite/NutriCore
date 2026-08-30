import { describe, expect, it } from "vitest";
import {
  ACTIVITY_MULTIPLIERS,
  ageFromBirthDate,
  calorieTarget,
  defaultMacroTargets,
  mifflinStJeor,
} from "./calories";

describe("Mifflin-St Jeor", () => {
  it("implements both equations", () => {
    expect(mifflinStJeor(80, 180, 30, "male")).toBe(1780);
    expect(mifflinStJeor(60, 165, 30, "female")).toBeCloseTo(1320.25);
  });

  it("differs by exactly 166 kcal between the two equations", () => {
    expect(mifflinStJeor(70, 175, 40, "male") - mifflinStJeor(70, 175, 40, "female")).toBe(166);
  });

  it("rejects impossible profile values", () => {
    expect(() => mifflinStJeor(0, 180, 30, "male")).toThrow(RangeError);
    expect(() => mifflinStJeor(80, 180, -1, "male")).toThrow(RangeError);
  });
});

describe("calorie target", () => {
  it("stores every part of the derivation", () => {
    const result = calorieTarget({ bmr: 1600, activityMultiplier: 1.55, goalAdjustment: -400 });
    expect(result).toMatchObject({ eligible: true, bmr: 1600, activityMultiplier: 1.55, tdee: 2480 });
    if (result.eligible) {
      expect(result.calculated).toBe(2080);
      expect(result.bmr * result.activityMultiplier + result.goalAdjustment).toBeCloseTo(result.calculated);
    }
  });

  it("caps extreme automatic deficits", () => {
    expect(calorieTarget({ bmr: 1500, activityMultiplier: 1.5, goalAdjustment: -900 })).toMatchObject({
      tdee: 2250,
      goalAdjustment: -500,
      final: 1750,
      clamped: true,
    });
  });

  it("never generates a target below the safety floor", () => {
    const result = calorieTarget({ bmr: 1100, activityMultiplier: 1.2, goalAdjustment: -500 });
    expect(result).toMatchObject({ eligible: true, calculated: 1200, clamped: true });
  });

  it("honours a manual override", () => {
    expect(calorieTarget({ bmr: 1500, activityMultiplier: 1.2, goalAdjustment: 0, override: 1900 })).toMatchObject({
      final: 1900,
    });
  });

  it("does not calculate protected scenarios but keeps overrides usable", () => {
    expect(calorieTarget({ bmr: 1000, activityMultiplier: 1.2, goalAdjustment: 0, age: 16 })).toMatchObject({
      eligible: false,
      warning: "medical-guidance-required",
    });
    expect(calorieTarget({ bmr: 1500, activityMultiplier: 1.4, goalAdjustment: 0, pregnant: true })).toMatchObject({
      eligible: false,
    });
    expect(
      calorieTarget({ bmr: 1500, activityMultiplier: 1.4, goalAdjustment: 0, breastfeeding: true, override: 2200 }),
    ).toMatchObject({ eligible: false, final: 2200 });
  });
});

describe("activity multipliers", () => {
  it("increases monotonically", () => {
    const values = Object.values(ACTIVITY_MULTIPLIERS);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });
});

describe("age", () => {
  it("does not count a birthday that has not happened yet", () => {
    expect(ageFromBirthDate(new Date("1990-12-01T00:00:00Z"), new Date("2026-08-30T00:00:00Z"))).toBe(35);
    expect(ageFromBirthDate(new Date("1990-01-01T00:00:00Z"), new Date("2026-08-30T00:00:00Z"))).toBe(36);
  });
});

describe("macro defaults", () => {
  it("splits the energy target without exceeding it", () => {
    const macros = defaultMacroTargets(2000, 70);
    const energy = macros.proteinG * 4 + macros.carbohydrateG * 4 + macros.fatG * 9;
    expect(energy).toBeGreaterThan(1900);
    expect(energy).toBeLessThanOrEqual(2010);
  });
});
