import { describe, expect, it } from "vitest";
import type { PortionContext } from "@/lib/units";
import { aiJobDestination, componentWeight, ingestionOptions, recipeIngredientAmount, scaleMealComponentsForIntent } from "./ai-types";

describe("ingestion intent", () => {
  it.each([
    [true, false, "MEAL", false], [false, true, "RECIPE", false], [true, true, "RECIPE", true], [false, false, "MEAL", false],
  ] as const)("maps add=%s recipe=%s", (add, recipe, intent, logAfterConfirm) => expect(ingestionOptions(add, recipe)).toEqual({ intent, logAfterConfirm }));
  it("routes by intent", () => {
    expect(aiJobDestination({ entityType: "AI_INGESTION", entityId: "i", intent: "MEAL", metadata: null })).toEqual({ kind: "MEAL_REVIEW", href: "/ai-review/i" });
    expect(aiJobDestination({ entityType: "AI_INGESTION", entityId: "i", intent: "RECIPE", metadata: { outcome: { recipeId: "r" } } })).toMatchObject({ recipeId: "r" });
  });
  it("scales meals but preserves whole-recipe amounts", () => {
    const parsed = { components: [{ name: "Soup", quantity: 4, estimatedGrams: 800 }], confidence: "high" as const, warnings: [] };
    expect(scaleMealComponentsForIntent(parsed, 4, "MEAL").components[0].quantity).toBe(1);
    expect(scaleMealComponentsForIntent(parsed, 4, "RECIPE").components[0].quantity).toBe(4);
  });
});

/** A gram-based food with no density and no named portions, as "Mehl" is. */
const flour: PortionContext = { basisUnit: "G", densityGPerMl: null, servings: [] };
/** A bread that does define a slice, so the source's own words are usable. */
const bread: PortionContext = { basisUnit: "G", densityGPerMl: null, servings: [{ label: "Scheibe", amount: 1, unit: "Scheibe", gramEquivalent: 30 }] };

describe("the weight behind a component", () => {
  it("prefers the chosen candidate, then the component, then the model", () => {
    const component = {
      name: "Brot",
      grams: 40,
      gramsSource: "PORTION" as const,
      estimatedGrams: 60,
      candidates: [{ foodId: "a", name: "A", brand: null, origin: "LOCAL" as const, score: 1, isEstimated: false, url: null, grams: 50, gramsSource: "SERVING" as const }],
    };

    expect(componentWeight(component, "a")).toEqual({ grams: 50, source: "SERVING" });
    // A food with no weight of its own falls back to the component's.
    expect(componentWeight(component, "b")).toEqual({ grams: 40, source: "PORTION" });
    expect(componentWeight({ name: "Mehl", estimatedGrams: 10 })).toEqual({ grams: 10, source: "MODEL" });
    expect(componentWeight({ name: "Salz" })).toBeNull();
  });
});

describe("what a component becomes as a recipe ingredient", () => {
  it("keeps the source's own amount and unit wherever the food can be measured in it", () => {
    expect(recipeIngredientAmount({ name: "Mehl", quantity: 200, unit: "g" }, "food", flour)).toEqual({ amount: 200, unit: "g", estimated: false });
    // The food's own spelling of the portion, so the recipe form offers it too.
    expect(recipeIngredientAmount({ name: "Brot", quantity: 2, unit: "Scheibe" }, "food", bread)).toEqual({ amount: 2, unit: "Scheibe", estimated: false });
    // A metric spelling the portion resolver does not know by itself.
    expect(recipeIngredientAmount({ name: "Mehl", quantity: 200, unit: "grams" }, "food", flour)).toEqual({ amount: 200, unit: "g", estimated: false });
  });

  /**
   * A plural the food states in the singular is not a unit `resolvePortion`
   * matches, so the ingredient is stored as the weight the resolver worked out
   * from that same serving row - a fact about the bread either way, and not an
   * estimate.
   */
  it("stores a portion word the food states differently as its resolved weight", () => {
    const component = {
      name: "Brot",
      quantity: 2,
      unit: "Scheiben",
      candidates: [{ foodId: "food", name: "Brot", brand: null, origin: "LOCAL" as const, score: 1, isEstimated: false, url: null, grams: 60, gramsSource: "SERVING" as const }],
    };

    expect(recipeIngredientAmount(component, "food", bread)).toEqual({ amount: 60, unit: "g", estimated: false });
  });

  /**
   * The bug this fixes. "1 EL Mehl" is a real ingredient of a real food, and the
   * flour defines no spoon - so before there was a gram fallback the whole
   * ingredient disappeared: out of the draft the reader checked, and out of the
   * recipe they confirmed, with only a warning naming the unit.
   */
  it("falls back to a gram weight for a household measure, and says it is estimated", () => {
    expect(recipeIngredientAmount({ name: "Mehl", quantity: 1, unit: "EL", estimatedGrams: 10 }, "food", flour))
      .toEqual({ amount: 10, unit: "g", estimated: true });
    expect(recipeIngredientAmount({ name: "Eier", quantity: 2, unit: "M", estimatedGrams: 120 }, "food", flour))
      .toEqual({ amount: 120, unit: "g", estimated: true });
  });

  it("counts a weight from the food's own serving data as stated rather than estimated", () => {
    const component = {
      name: "Brot",
      quantity: 2,
      unit: "Stück",
      candidates: [{ foodId: "food", name: "Brot", brand: null, origin: "LOCAL" as const, score: 1, isEstimated: false, url: null, grams: 60, gramsSource: "PORTION" as const }],
    };

    expect(recipeIngredientAmount(component, "food", flour)).toEqual({ amount: 60, unit: "g", estimated: false });
  });

  it("refuses a component that cannot be weighed at all rather than inventing one", () => {
    expect(recipeIngredientAmount({ name: "Gewürze" }, "food", flour)).toBeNull();
    expect(recipeIngredientAmount({ name: "Salz", quantity: 1, unit: "Prise" }, "food", flour)).toBeNull();
  });
});
