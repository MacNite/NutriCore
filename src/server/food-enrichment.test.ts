import { describe, expect, it } from "vitest";
import { aiEnrichmentMetadata, missingNutritionKeys } from "./food-enrichment";

describe("food enrichment", () => {
  it("detects absent and explicitly unknown nutrients without treating zero as missing", () => {
    expect(missingNutritionKeys([{ key: "protein" }, { key: "iron" }, { key: "salt" }], [
      { nutrientKey: "protein", value: 0 }, { nutrientKey: "iron", value: null },
    ])).toEqual(["iron", "salt"]);
  });
  it("only exposes an AI badge audit when something was filled", () => {
    const date = new Date("2026-01-02T00:00:00Z");
    expect(aiEnrichmentMetadata([{ provider: "OPEN_FOOD_FACTS", metadata: null, retrievedAt: date }])).toEqual([]);
    expect(aiEnrichmentMetadata([{ provider: "AI_ENRICHMENT", metadata: { nutrientKeys: [] }, retrievedAt: date }])).toEqual([]);
    expect(aiEnrichmentMetadata([{ provider: "AI_ENRICHMENT", metadata: { nutrientKeys: ["iron"], addedAt: date.toISOString() }, retrievedAt: date }])[0].nutrientKeys).toEqual(["iron"]);
  });
});
