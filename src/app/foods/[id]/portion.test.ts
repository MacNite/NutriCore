import { describe, expect, it } from "vitest";
import { initialPortion, portionPreview, portionUnits, preferredInitialPortion, type FoodShape } from "./portion";

const food = (overrides: Partial<FoodShape> = {}): FoodShape => ({
  id: "food-1",
  basisUnit: "G",
  servingSize: null,
  servingUnit: null,
  densityGPerMl: null,
  servings: [],
  ...overrides,
});

const nutrients = { energyKcal: 87, protein: 12.3, vitaminC: null };

describe("portionPreview", () => {
  it("scales the basis values to the entered portion", () => {
    const preview = portionPreview(200, "g", food(), nutrients, 100);
    expect(preview.amount).toBe(200);
    expect(preview.nutrients).toEqual({ energyKcal: 174, protein: 24.6, vitaminC: null });
    expect(preview.converted).toBe(false);
  });

  it("keeps an unknown nutrient unknown instead of turning it into zero", () => {
    expect(portionPreview(50, "g", food(), nutrients, 100).nutrients?.vitaminC).toBeNull();
  });

  it("reports the resolved amount for a unit that had to be converted", () => {
    const preview = portionPreview(0.25, "kg", food(), nutrients, 100);
    expect(preview.amount).toBe(250);
    expect(preview.converted).toBe(true);
  });

  it("resolves a named portion through the food's own weight", () => {
    const sliced = food({ servings: [{ label: "Scheibe", gramEquivalent: 25, mlEquivalent: null }] });
    const preview = portionPreview(2, "Scheibe", sliced, nutrients, 100);
    expect(preview.amount).toBe(50);
    expect(preview.nutrients?.energyKcal).toBeCloseTo(43.5);
    expect(preview.converted).toBe(true);
  });

  it("shows no values for a portion the diary would refuse", () => {
    // Millilitres of a gram food without a density: never guessed at 1 ml = 1 g.
    expect(portionPreview(200, "ml", food(), nutrients, 100).nutrients).toBeNull();
    expect(portionPreview(Number.NaN, "g", food(), nutrients, 100).nutrients).toBeNull();
    expect(portionPreview(-5, "g", food(), nutrients, 100).nutrients).toBeNull();
    expect(portionPreview(200, "Scheibe", food(), nutrients, 100).nutrients).toBeNull();
  });
});

describe("portionUnits", () => {
  it("offers the other measure family only with a density", () => {
    expect(portionUnits(food())).toEqual(["g", "kg"]);
    expect(portionUnits(food({ densityGPerMl: 1.03 }))).toEqual(["g", "kg", "ml"]);
    expect(portionUnits(food({ basisUnit: "ML" }))).toEqual(["ml", "l"]);
  });

  it("lists the food's own named portions", () => {
    const sliced = food({ servings: [{ label: "Scheibe", gramEquivalent: 25, mlEquivalent: null }] });
    expect(portionUnits(sliced)).toEqual(["g", "kg", "Scheibe"]);
  });
});

describe("initialPortion", () => {
  it("starts at the food's serving size", () => {
    expect(initialPortion(food({ servingSize: 30, servingUnit: "g" }))).toEqual({ quantity: "30", unit: "g" });
  });

  it("rounds a calculated serving weight for the initial input", () => {
    expect(initialPortion(food({ servingSize: 64.292, servingUnit: "serving" }))).toEqual({ quantity: "64", unit: "g" });
  });

  it("falls back to a unit the form actually offers", () => {
    // A serving unit with no serving size never reaches the dropdown, so the
    // preview would otherwise scale a portion the form cannot show.
    expect(initialPortion(food({ servingUnit: "Scheibe" }))).toEqual({ quantity: "100", unit: "g" });
  });
});

describe("preferredInitialPortion", () => {
  it("restores the user's last quantity and unit", () => {
    expect(preferredInitialPortion(food(), { quantity: 80, unit: "g" })).toEqual({ quantity: "80", unit: "g" });
    expect(preferredInitialPortion(food({ basisUnit: "ML" }), { quantity: 0.5, unit: "l" })).toEqual({ quantity: "0.5", unit: "l" });
  });

  it("restores a named serving that the food still offers", () => {
    const sliced = food({ servings: [{ label: "Scheibe", gramEquivalent: 25, mlEquivalent: null }] });
    expect(preferredInitialPortion(sliced, { quantity: 2, unit: "Scheibe" })).toEqual({ quantity: "2", unit: "Scheibe" });
  });

  it("falls back when the remembered portion is no longer valid", () => {
    expect(preferredInitialPortion(food(), { quantity: 2, unit: "Scheibe" })).toEqual({ quantity: "100", unit: "g" });
    expect(preferredInitialPortion(food(), { quantity: 0, unit: "g" })).toEqual({ quantity: "100", unit: "g" });
  });
});
