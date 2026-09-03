import { describe, expect, it } from "vitest";
import { aiJobDestination, ingestionOptions, scaleMealComponentsForIntent } from "./ai-types";

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
