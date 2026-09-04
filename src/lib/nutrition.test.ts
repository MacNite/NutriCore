import { describe, expect, it } from "vitest";
import { kcalToKj, kjToKcal, kgToG, nutrientCoverage, recipeNutrition, roundForDisplay, saltToSodium, scaleNutrients, sodiumToSalt, sumWithCoverage } from "./nutrition";

describe("nutrition math", () => {
  it("converts energy and mass", () => {
    expect(kcalToKj(100)).toBeCloseTo(418.4);
    expect(kjToKcal(418.4)).toBeCloseTo(100);
    expect(kgToG(1.25)).toBe(1250);
  });

  it("converts salt explicitly", () => {
    expect(sodiumToSalt(0.4)).toBe(1);
    expect(saltToSodium(1)).toBe(0.4);
  });

  it("scales per 100g while retaining unknown", () => {
    expect(scaleNutrients({ protein: 20, vitaminC: null }, 100, 150)).toEqual({ protein: 30, vitaminC: null });
  });

  it("calculates recipes and changing yield", () => {
    const recipe = recipeNutrition([
      { nutrients: { kcal: 100, iron: null }, basisAmount: 100, amount: 200 },
      { nutrients: { kcal: 50, iron: 2 }, basisAmount: 100, amount: 100 },
    ], 2);
    expect(recipe.total.kcal).toBe(250);
    expect(recipe.perServing.kcal).toBe(125);
    expect(recipe.total.iron).toBeNull();
  });

  it("uses resolved mass for volume-based ingredients", () => {
    const recipe = recipeNutrition([{ nutrients: { energyKcal: 50 }, basisAmount: 100, amount: 200, weightG: 160 }], 2);
    expect(recipe.ingredientWeightG).toBe(160);
    expect(recipe.portionWeightG).toBe(80);
    expect(recipe.total.energyKcal).toBe(100);
  });

  it("keeps the known daily fat sum when another food has no fat entry", () => {
    const result = sumWithCoverage([
      { amount: 100, nutrients: { fat: 12 } },
      { amount: 333, nutrients: { fat: null } },
    ], ["fat"]);

    expect(result.total.fat).toBeNull();
    expect(result.known.fat).toBe(12);
    expect(result.coverage.fat).toBeCloseTo(100 / 433);
  });

  it("reports weighted coverage", () => {
    expect(nutrientCoverage([{ amount: 60, value: 2 }, { amount: 40, value: null }])).toBe(0.6);
  });

  it("rounds presentation only", () => {
    expect(roundForDisplay(1.255, 2)).toBe(1.26);
  });
});
