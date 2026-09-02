import { describe, expect, it, vi } from "vitest";
import { aiEnrichmentMetadata, extractNutritionForName, isPlausibleNutrition, missingNutritionKeys, normalizeNutritionPer100g, rankNutritionSources } from "./food-enrichment";
import type { OllamaProvider } from "@/providers/ollama";
import type { SearxngClient } from "@/providers/searxng";

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

describe("nutrition source ranking", () => {
  it("prefers food relevance and per-100-g nutrition evidence over result order", () => {
    const ranked = rankNutritionSources("Greek yogurt", ["protein"], [
      { title: "Travel blog", url: "https://first.test", pageText: "An unrelated long article" },
      { title: "Greek yogurt nutrition facts", url: "https://facts.test", pageText: "Nutrition per 100 g Protein 10 g" },
    ]);
    expect(ranked[0].url).toBe("https://facts.test");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
  it("uses search order only to break evidence ties", () => {
    const ranked = rankNutritionSources("tofu", ["protein"], [
      { title: "Tofu nutrition", url: "https://a.test", pageText: "per 100g protein" },
      { title: "Tofu nutrition", url: "https://b.test", pageText: "per 100g protein" },
    ]);
    expect(ranked.map((item) => item.url)).toEqual(["https://a.test", "https://b.test"]);
  });
});

describe("nutrition normalization", () => {
  it("scales explicit 30-g and 50-g bases and leaves 100-g values unchanged", () => {
    expect(normalizeNutritionPer100g({ basisAmount: 30, basisUnit: "g", nutrients: { energyKcal: 120, protein: 4 } })).toEqual({ energyKcal: 400, protein: 13.333333333333334 });
    expect(normalizeNutritionPer100g({ basisAmount: 100, basisUnit: "g", nutrients: { protein: 12 } })).toEqual({ protein: 12 });
    expect(normalizeNutritionPer100g({ basisAmount: 50, basisUnit: "g", nutrients: { protein: 6 } })).toEqual({ protein: 12 });
  });
  it("requires an explicit serving gram weight and rejects millilitres", () => {
    expect(normalizeNutritionPer100g({ basisAmount: 1, basisUnit: "serving", servingSizeG: 30, nutrients: { energyKcal: 120 } })).toEqual({ energyKcal: 400 });
    expect(normalizeNutritionPer100g({ basisAmount: 1, basisUnit: "serving", nutrients: { energyKcal: 120 } })).toBeNull();
    expect(normalizeNutritionPer100g({ basisAmount: 100, basisUnit: "ml", nutrients: { energyKcal: 20 } })).toBeNull();
  });
});

describe("nutrition plausibility", () => {
  it("accepts normal foods and pure oil", () => {
    expect(isPlausibleNutrition({ energyKcal: 250, protein: 12, carbohydrate: 30, fat: 8 })).toBe(true);
    expect(isPlausibleNutrition({ energyKcal: 900, fat: 100 })).toBe(true);
  });
  it("rejects negative, over-100-g protein, absurd energy, and impossible macro sums", () => {
    expect(isPlausibleNutrition({ protein: -1 })).toBe(false);
    expect(isPlausibleNutrition({ protein: 150 })).toBe(false);
    expect(isPlausibleNutrition({ energyKcal: 1200 })).toBe(false);
    expect(isPlausibleNutrition({ protein: 60, carbohydrate: 60, fat: 10 })).toBe(false);
  });
});

describe("source retries", () => {
  it("survives fetch failure, retries an unusable extraction, and selects the second usable source", async () => {
    const search = { search: async () => [
      { title: "broken", url: "https://broken.test" },
      { title: "Tofu nutrition facts", url: "https://bad.test" },
      { title: "Tofu nutrition facts", url: "https://good.test" },
    ] } as unknown as SearxngClient;
    const fetchSource = async (url: string) => {
      if (url.includes("broken")) throw new Error("network");
      return { url, excerpt: url.includes("bad") ? "Tofu nutrition per 100 g protein" : "Tofu nutrition per 100 g protein 12 g" };
    };
    const complete = vi.fn()
      .mockResolvedValueOnce({ basisAmount: 1, basisUnit: "serving", nutrients: { protein: 12 } })
      .mockResolvedValueOnce({ basisAmount: 100, basisUnit: "g", nutrients: { protein: 12 } });
    const ai = { capabilities: async () => ({ model: "local" }), complete } as unknown as OllamaProvider;
    const result = await extractNutritionForName("Tofu", ["protein"], { search, ai, fetchSource: fetchSource as never });
    expect(result).toMatchObject({ url: "https://good.test", per100g: { protein: 12 }, consideredUrls: ["https://broken.test", "https://bad.test", "https://good.test"] });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("caps model attempts at two", async () => {
    const search = { search: async () => [1, 2, 3].map((n) => ({ title: `Food nutrition ${n}`, url: `https://${n}.test` })) } as unknown as SearxngClient;
    const ai = { capabilities: async () => ({ model: "local" }), complete: vi.fn().mockResolvedValue({ basisAmount: 100, basisUnit: "ml", nutrients: { protein: 2 } }) } as unknown as OllamaProvider;
    await expect(extractNutritionForName("Food", ["protein"], { search, ai, fetchSource: (async (url: string) => ({ url, excerpt: "Food nutrition per 100 g protein" })) as never })).resolves.toBeNull();
    expect(ai.complete).toHaveBeenCalledTimes(2);
  });
});
