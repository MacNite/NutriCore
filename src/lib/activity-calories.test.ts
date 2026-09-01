import { describe, expect, it } from "vitest";
import { calculateExerciseEnergy } from "./activity-calories";
import { findActivityVariant } from "./activities";

describe("MET exercise energy", () => {
  it("calculates gross and active energy", () => expect(calculateExerciseEnergy(8, 70, 30)).toEqual({ grossKcal: 294, activeKcal: 257.25 }));
  it("subtracts rest and floors 1 MET at zero", () => expect(calculateExerciseEnergy(1, 70, 30).activeKcal).toBe(0));
  it("scales proportionally with weight and duration", () => {
    const base = calculateExerciseEnergy(5, 60, 30).activeKcal;
    expect(calculateExerciseEnergy(5, 120, 30).activeKcal).toBe(base * 2);
    expect(calculateExerciseEnergy(5, 60, 60).activeKcal).toBe(base * 2);
  });
  it.each([[0, 70, 30], [5, -1, 30], [5, 70, 0], [NaN, 70, 30]])("rejects invalid values", (met, kg, minutes) => expect(() => calculateExerciseEnergy(met, kg, minutes)).toThrow(RangeError));
});

describe("activity catalogue", () => {
  it("resolves valid pairs", () => expect(findActivityVariant("walking", "brisk")?.variant.met).toBe(4.8));
  it("rejects invalid pairs", () => expect(findActivityVariant("walking", "vigorous")).toBeNull());
});
