import { describe, expect, it } from "vitest";
import {
  chooseNutrition,
  mayTransition,
  researchResultSchema,
  scoreConfidence,
  totalYieldWeightG,
  type ResearchStatus,
} from "./research";

const valid = {
  kind: "recipe" as const,
  name: "Döner Teller Hähnchen",
  language: "de" as const,
  description: "",
  ingredients: [{ name: "Hähnchenfleisch", amount: 200, unit: "g" as const, confidence: 0.8 }],
  servings: 1,
  assumptions: [],
  sources: [],
  confidence: 0.5,
};

describe("AI result schema", () => {
  it("accepts a well-formed result", () => {
    expect(researchResultSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a result without ingredients", () => {
    expect(researchResultSchema.safeParse({ ...valid, ingredients: [] }).success).toBe(false);
    expect(researchResultSchema.safeParse({ kind: "food", name: "x" }).success).toBe(false);
  });

  it("rejects impossible quantities and confidences", () => {
    expect(researchResultSchema.safeParse({ ...valid, servings: 0 }).success).toBe(false);
    expect(researchResultSchema.safeParse({ ...valid, confidence: 1.5 }).success).toBe(false);
    expect(
      researchResultSchema.safeParse({ ...valid, ingredients: [{ ...valid.ingredients[0], amount: -5 }] }).success,
    ).toBe(false);
  });

  it("rejects an unsupported unit so a portion is never guessed", () => {
    expect(
      researchResultSchema.safeParse({ ...valid, ingredients: [{ ...valid.ingredients[0], unit: "handful" }] }).success,
    ).toBe(false);
  });

  it("rejects a non-URL source", () => {
    expect(researchResultSchema.safeParse({ ...valid, sources: [{ title: "t", url: "not a url" }] }).success).toBe(
      false,
    );
  });

  it("defaults modelEstimated to false", () => {
    const parsed = researchResultSchema.parse(valid);
    expect(parsed.modelEstimated).toBe(false);
  });
});

describe("research state machine", () => {
  it("requires explicit confirmation before acceptance", () => {
    expect(mayTransition("CALCULATING", "ACCEPTED")).toBe(false);
    expect(mayTransition("REQUESTED", "ACCEPTED")).toBe(false);
    expect(mayTransition("AWAITING_CONFIRMATION", "ACCEPTED")).toBe(true);
    expect(mayTransition("AWAITING_CONFIRMATION", "REJECTED")).toBe(true);
  });

  it("treats accepted, rejected and failed as terminal", () => {
    for (const status of ["ACCEPTED", "REJECTED", "FAILED"] as ResearchStatus[]) {
      expect(mayTransition(status, "SEARCHING")).toBe(false);
      expect(mayTransition(status, "ACCEPTED")).toBe(false);
    }
  });

  it("allows a failure from any working state", () => {
    for (const status of ["REQUESTED", "SEARCHING", "EXTRACTING", "CALCULATING"] as ResearchStatus[]) {
      expect(mayTransition(status, "FAILED")).toBe(true);
    }
  });

  it("can skip web search when research is disabled", () => {
    expect(mayTransition("REQUESTED", "EXTRACTING")).toBe(true);
  });
});

describe("confidence scoring", () => {
  const base = {
    sourceCount: 0,
    sourcesAgree: false,
    matchedIngredientRatio: 0,
    allQuantitiesPresent: false,
    knownServingWeight: false,
    modelEstimatedNutrition: false,
    vagueDescription: false,
  };

  it("scores a well-supported result high", () => {
    const result = scoreConfidence({
      ...base,
      sourceCount: 3,
      sourcesAgree: true,
      matchedIngredientRatio: 1,
      allQuantitiesPresent: true,
      knownServingWeight: true,
    });
    expect(result.band).toBe("high");
    expect(result.score).toBeGreaterThan(0.7);
  });

  it("scores an unsupported model guess low", () => {
    const result = scoreConfidence({ ...base, modelEstimatedNutrition: true, vagueDescription: true });
    expect(result.band).toBe("low");
  });

  it("stays within 0 and 1", () => {
    expect(scoreConfidence({ ...base, matchedIngredientRatio: 1, sourceCount: 9, sourcesAgree: true, allQuantitiesPresent: true, knownServingWeight: true }).score).toBeLessThanOrEqual(1);
    expect(
      scoreConfidence({ ...base, modelEstimatedNutrition: true, vagueDescription: true, sourceCount: 2 }).score,
    ).toBeGreaterThanOrEqual(0);
  });

  it("explains every contribution", () => {
    const result = scoreConfidence({ ...base, modelEstimatedNutrition: true });
    expect(result.reasons.map((r) => r.key)).toContain("modelEstimatedNutrition");
    expect(result.reasons.every((r) => r.effect !== 0)).toBe(true);
  });

  it("penalises conflicting sources", () => {
    const agree = scoreConfidence({ ...base, sourceCount: 3, sourcesAgree: true });
    const conflict = scoreConfidence({ ...base, sourceCount: 3, sourcesAgree: false });
    expect(agree.score).toBeGreaterThan(conflict.score);
  });
});

describe("yield weight", () => {
  it("multiplies the serving weight by the number of servings", () => {
    // A 2-serving dish at 360 g per serving weighs 720 g in total; using 360 g
    // as the yield made every per-100 g value twice as large as it should be.
    expect(totalYieldWeightG(2, 360)).toBe(720);
    expect(totalYieldWeightG(1, 360)).toBe(360);
  });

  it("returns nothing when the model did not state a serving weight", () => {
    expect(totalYieldWeightG(4, undefined)).toBeUndefined();
  });

  it("falls back to the serving weight for an impossible serving count", () => {
    expect(totalYieldWeightG(0, 250)).toBe(250);
    expect(totalYieldWeightG(Number.NaN, 250)).toBe(250);
  });
});

describe("choosing where nutrition comes from", () => {
  const calculated = { energyKcal: 125.7, protein: 11.2 };
  const model = { energyKcal: 250, protein: 9 };

  it("prefers the database calculation when every ingredient resolved", () => {
    const chosen = chooseNutrition({ calculatedPer100g: calculated, modelPer100g: model, matchedIngredientRatio: 1 });
    expect(chosen).toEqual({ per100g: calculated, source: "INGREDIENTS" });
  });

  it("uses the model when ingredients are missing, rather than an empty result", () => {
    const chosen = chooseNutrition({ calculatedPer100g: null, modelPer100g: model, matchedIngredientRatio: 0 });
    expect(chosen).toEqual({ per100g: model, source: "MODEL" });
  });

  it("does not blend a partial calculation with model numbers", () => {
    const chosen = chooseNutrition({ calculatedPer100g: calculated, modelPer100g: model, matchedIngredientRatio: 0.5 });
    expect(chosen.source).toBe("MODEL");
    expect(chosen.per100g).toEqual(model);
  });

  it("falls back to a partial calculation when the model supplied nothing", () => {
    const chosen = chooseNutrition({ calculatedPer100g: calculated, matchedIngredientRatio: 0.5 });
    expect(chosen.source).toBe("PARTIAL_INGREDIENTS");
  });

  it("reports NONE instead of inventing zeroes", () => {
    expect(chooseNutrition({ calculatedPer100g: { energyKcal: null }, matchedIngredientRatio: 0 })).toEqual({ per100g: {}, source: "NONE" });
    expect(chooseNutrition({ calculatedPer100g: null, modelPer100g: {}, matchedIngredientRatio: 0 }).source).toBe("NONE");
  });
});

describe("model-supplied nutrition schema", () => {
  it("accepts a result that carries per-100 g values", () => {
    const parsed = researchResultSchema.safeParse({ ...valid, nutritionPer100g: { energyKcal: 215, protein: 12, carbohydrate: 20, fat: 9 } });
    expect(parsed.success).toBe(true);
  });

  it("stays optional so a model that omits it still produces a usable result", () => {
    expect(researchResultSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects impossible energy densities", () => {
    const parsed = researchResultSchema.safeParse({ ...valid, nutritionPer100g: { energyKcal: 5000, protein: 12, carbohydrate: 20, fat: 9 } });
    expect(parsed.success).toBe(false);
  });
});
