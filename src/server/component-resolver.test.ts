import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { resolveGrams } from "./component-resolver";

interface WeightFacts {
  servingSize: number | null;
  servingUnit: string | null;
  densityGPerMl: number | null;
  servings: { label: string; amount: number; unit: string; gramEquivalent: number | null; mlEquivalent: number | null }[];
}

/** A food as `searchFoods` returns it, reduced to what the weight needs. */
const food = (over: Partial<WeightFacts> = {}): WeightFacts => ({
  servingSize: null,
  servingUnit: null,
  densityGPerMl: null,
  servings: [],
  ...over,
});

describe("how many grams a component logs", () => {
  /**
   * The case behind the whole resolver: "2 Scheiben Brot". The weight is a fact
   * about the bread, so the bread's own slice weight has to win over the model's
   * guess - and switching to a different bread has to change the answer.
   */
  it("prefers the resolved food's own serving over the model's estimate", () => {
    const component = { quantity: 2, unit: "Scheibe", estimatedGrams: 60 };
    const thin = food({ servings: [{ label: "Scheibe", amount: 1, unit: "Scheibe", gramEquivalent: 25, mlEquivalent: null }] });
    const thick = food({ servings: [{ label: "Scheibe", amount: 1, unit: "Scheibe", gramEquivalent: 45, mlEquivalent: null }] });

    expect(resolveGrams(component, thin)).toEqual({ grams: 50, source: "SERVING" });
    expect(resolveGrams(component, thick)).toEqual({ grams: 90, source: "SERVING" });
  });

  it("matches a plural the model wrote against a singular serving label", () => {
    const component = { quantity: 3, unit: "Scheiben" };
    const bread = food({ servings: [{ label: "Scheibe", amount: 1, unit: "Scheibe", gramEquivalent: 30, mlEquivalent: null }] });
    expect(resolveGrams(component, bread)).toEqual({ grams: 90, source: "SERVING" });
  });

  /**
   * The failure that reached production: Open Food Facts labels its serving
   * after the amount ("30 g"), never "Scheibe", so requiring the words to match
   * left "2 Scheiben Brot" with no weight - and a component with no weight
   * cannot be logged, however well the food matched.
   */
  it("uses the food's portion weight for a portion word it does not name", () => {
    const offBread = food({
      servingSize: 30,
      servingUnit: "g",
      servings: [{ label: "30 g", amount: 30, unit: "g", gramEquivalent: 30, mlEquivalent: null }],
    });
    expect(resolveGrams({ quantity: 2, unit: "Scheiben" }, offBread)).toEqual({ grams: 60, source: "PORTION" });
  });

  it("prefers a named serving over the generic portion weight", () => {
    const bread = food({
      servingSize: 30,
      servingUnit: "g",
      servings: [
        { label: "Scheibe", amount: 1, unit: "Scheibe", gramEquivalent: 45, mlEquivalent: null },
        { label: "30 g", amount: 30, unit: "g", gramEquivalent: 30, mlEquivalent: null },
      ],
    });
    expect(resolveGrams({ quantity: 2, unit: "Scheiben" }, bread)).toEqual({ grams: 90, source: "SERVING" });
  });

  /** A misread unit must not log kilograms; the model's reading takes over. */
  it("discards an implausible weight and falls through to the model", () => {
    const bread = food({ servingSize: 30, servingUnit: "g" });
    expect(resolveGrams({ quantity: 400, unit: "Scheiben", estimatedGrams: 60 }, bread)).toEqual({
      grams: 60,
      source: "MODEL",
    });
    // With nothing to fall back to, no weight is reported rather than a wrong one.
    expect(resolveGrams({ quantity: 400, unit: "Scheiben" }, bread)).toEqual({ grams: null, source: "NONE" });
  });

  it("uses servingSize when the food carries no serving rows", () => {
    const component = { quantity: 2, unit: "Portion" };
    const yoghurt = food({ servingSize: 150, servingUnit: "Portion" });
    expect(resolveGrams(component, yoghurt)).toEqual({ grams: 300, source: "SERVING" });
  });

  it("takes a stated weight or volume as it is", () => {
    expect(resolveGrams({ quantity: 80, unit: "g", estimatedGrams: 200 }, null)).toEqual({ grams: 80, source: "UNIT" });
    expect(resolveGrams({ quantity: 250, unit: "ml" }, food({ densityGPerMl: 1.25 }))).toEqual({
      grams: 312.5,
      source: "UNIT",
    });
  });

  /**
   * A portion size is an interpretation of the sentence rather than a fact about
   * a food, so the model owns it when nothing better exists - which is most of
   * the time, because sources rarely state grams per slice.
   */
  it("falls back to the model when neither the unit nor the food helps", () => {
    expect(resolveGrams({ quantity: 1, unit: "Handvoll", estimatedGrams: 30 }, food())).toEqual({
      grams: 30,
      source: "MODEL",
    });
  });

  it("reports no weight rather than inventing one", () => {
    // A food that knows no portion weight at all cannot answer "1 Scheibe".
    expect(resolveGrams({ quantity: 1, unit: "Scheibe" }, food())).toEqual({ grams: null, source: "NONE" });
    expect(resolveGrams({ estimatedGrams: 0 }, null)).toEqual({ grams: null, source: "NONE" });
  });

  it("does not mistake a short unit for a different short serving", () => {
    // "Eis" against an "Ei" serving must not match on a shared opening.
    const eggs = food({ servings: [{ label: "Ei", amount: 1, unit: "Ei", gramEquivalent: 60, mlEquivalent: null }] });
    // The words do not match, so this is the generic portion rule rather than a
    // claimed match on "Ei" - 2 portions of 60 g, and the source says so.
    expect(resolveGrams({ quantity: 2, unit: "Eis", estimatedGrams: 100 }, eggs)).toEqual({
      grams: 120,
      source: "PORTION",
    });
  });

  it("ignores a serving row that has no gram equivalent", () => {
    const component = { quantity: 2, unit: "Scheibe", estimatedGrams: 60 };
    const useless = food({ servings: [{ label: "Scheibe", amount: 1, unit: "Scheibe", gramEquivalent: null, mlEquivalent: null }] });
    expect(resolveGrams(component, useless)).toEqual({ grams: 60, source: "MODEL" });
  });
});
