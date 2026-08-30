import { describe, expect, it } from "vitest";
import { mayTransition, researchResultSchema, scoreConfidence, type ResearchStatus } from "./research";

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
