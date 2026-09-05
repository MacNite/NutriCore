import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Most of this file exercises pure functions, but the permission gate and
// `enrichFood` are the parts the workflow actually got wrong, and both read the
// database. Only the handful of models they touch are mocked.
const { prismaMock, food, nutrientDefinition, userProfile, foodNutrient, enrichmentProposal, enrichmentProposalValue } = vi.hoisted(() => {
  const food = { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) };
  const nutrientDefinition = { findMany: vi.fn() };
  const userProfile = { findMany: vi.fn(), findUnique: vi.fn(async (): Promise<{ autoApplyEnrichment: boolean } | null> => null) };
  const foodNutrient = { updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn() };
  const enrichmentProposal = { create: vi.fn(async () => ({ id: "proposal-1" })), update: vi.fn() };
  const enrichmentProposalValue = { create: vi.fn() };
  const tx = { food, foodNutrient, foodSource: { create: vi.fn() }, enrichmentProposal, enrichmentProposalValue };
  return {
    food,
    nutrientDefinition,
    userProfile,
    foodNutrient,
    enrichmentProposal,
    enrichmentProposalValue,
    prismaMock: { ...tx, nutrientDefinition, userProfile, $transaction: vi.fn(async (run: (t: typeof tx) => unknown) => run(tx)) },
  };
});
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { aiEnrichmentMetadata, enrichFood, enrichmentBlock, extractNutritionForName, isPlausibleNutrition, missingNutritionKeys, normalizeNutritionPer100g, permittedForEnrichment, rankNutritionSources } from "./food-enrichment";
import { AIInvalidOutputError, AIUnavailableError } from "@/providers/ai";
import type { OllamaProvider } from "@/providers/ollama";
import type { SearxngClient } from "@/providers/searxng";

describe("food enrichment", () => {
  it("detects absent and explicitly unknown nutrients without treating zero as missing", () => {
    expect(missingNutritionKeys([{ key: "protein" }, { key: "iron" }, { key: "salt" }], [
      { nutrientKey: "protein", value: 0 }, { nutrientKey: "iron", value: null },
    ])).toEqual(["iron", "salt"]);
  });
  it("reads the AI badge off the food's live values, not off what a run once wrote", () => {
    const date = new Date("2026-01-02T00:00:00Z");
    const aiRun = { provider: "AI_ENRICHMENT", metadata: { addedAt: date.toISOString() }, retrievedAt: date };
    const ai = { nutrientKey: "iron", value: 0.4, origin: "AI_ENRICHMENT" };
    const measured = { nutrientKey: "protein", value: 12, origin: "Analyse" };

    // No AI run at all: nothing to badge.
    expect(aiEnrichmentMetadata([ai], [{ provider: "OPEN_FOOD_FACTS", metadata: null, retrievedAt: date }])).toEqual([]);
    // A run that wrote nothing the food still holds is not badged either.
    expect(aiEnrichmentMetadata([measured], [aiRun])).toEqual([]);
    expect(aiEnrichmentMetadata([ai, measured], [aiRun])[0].nutrientKeys).toEqual(["iron"]);

    // The reason for reading the values rather than the record: a dataset import
    // that reclaims a nutrient leaves the old metadata still naming it.
    const stale = { provider: "AI_ENRICHMENT", metadata: { nutrientKeys: ["iron", "calcium"], addedAt: date.toISOString() }, retrievedAt: date };
    expect(aiEnrichmentMetadata([ai, measured], [stale])[0].nutrientKeys).toEqual(["iron"]);
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
  it("matches an umlaut name against the page that actually names it", () => {
    // "Käse" tokenised to nothing at all, so both of these scored identically on
    // their other evidence and the tie fell to search order.
    const ranked = rankNutritionSources("Käse", ["protein"], [
      { title: "Nährwerte", url: "https://generic.test", pageText: "Nährwerte pro 100 g: Protein 25 g" },
      { title: "Käse Nährwerte", url: "https://cheese.test", pageText: "Käse: Nährwerte pro 100 g, Protein 25 g" },
    ]);
    expect(ranked[0].url).toBe("https://cheese.test");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
  it("does not read a recipe's own '100 g Zucker' as a per-100-g basis", () => {
    const [blog] = rankNutritionSources("Zucker", ["protein"], [
      { title: "Kuchen Rezept", url: "https://blog.test", pageText: "Zutaten: 100 g Zucker, 2 Eier" },
    ]);
    // Unqualified, the quantity awarded the largest bonus in the score and, via
    // `prose`, cancelled the blog penalty with it.
    expect(blog.score).toBeLessThan(0);
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
  it("requires an explicit serving gram weight, and refuses millilitres for a food stored by mass", () => {
    expect(normalizeNutritionPer100g({ basisAmount: 1, basisUnit: "serving", servingSizeG: 30, nutrients: { energyKcal: 120 } })).toEqual({ energyKcal: 400 });
    expect(normalizeNutritionPer100g({ basisAmount: 1, basisUnit: "serving", nutrients: { energyKcal: 120 } })).toBeNull();
    // No density, so there is nothing to convert the volume through.
    expect(normalizeNutritionPer100g({ basisAmount: 100, basisUnit: "ml", nutrients: { energyKcal: 20 } })).toBeNull();
  });

  it("takes a per-100-ml label for a drink, which is how every drink states it", () => {
    // A food keeps its nutrients per 100 of its own basis unit, so for a food
    // stored in millilitres this is already the right basis. Rejecting it left
    // beverages permanently unenrichable.
    expect(normalizeNutritionPer100g(
      { basisAmount: 100, basisUnit: "ml", nutrients: { energyKcal: 42 } },
      { basisUnit: "ML" },
    )).toEqual({ energyKcal: 42 });
    expect(normalizeNutritionPer100g(
      { basisAmount: 250, basisUnit: "ml", nutrients: { energyKcal: 105 } },
      { basisUnit: "ML" },
    )).toEqual({ energyKcal: 42 });
  });

  it("crosses between mass and volume only through a stated density", () => {
    expect(normalizeNutritionPer100g({ basisAmount: 100, basisUnit: "g", nutrients: { fat: 90 } }, { basisUnit: "ML" })).toBeNull();
    expect(normalizeNutritionPer100g(
      { basisAmount: 100, basisUnit: "g", nutrients: { fat: 92 } },
      { basisUnit: "ML", densityGPerMl: 0.92 },
    )).toEqual({ fat: 84.64 });
  });

  it("gives a volume basis the headroom its density needs", () => {
    // 100 ml of honey is about 142 g, so its sugars per 100 ml legitimately
    // exceed the 100 a mass basis caps at.
    expect(isPlausibleNutrition({ sugar: 117 }, { basisUnit: "ML" })).toBe(true);
    expect(isPlausibleNutrition({ sugar: 117 })).toBe(false);
    expect(isPlausibleNutrition({ sugar: 400 }, { basisUnit: "ML" })).toBe(false);
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

  it("retrieves only the pages it can read, not every result the search offered", async () => {
    // Fetching five to read two spent three requests on other people's servers
    // for nothing. The title and snippet decide which are worth retrieving.
    const search = { search: async () => [1, 2, 3, 4, 5].map((n) => ({ title: `Tofu nutrition ${n}`, url: `https://${n}.test` })) } as unknown as SearxngClient;
    const fetchSource = vi.fn(async (url: string) => ({ url, excerpt: "Tofu nutrition per 100 g protein 12 g" }));
    const ai = { capabilities: async () => ({ model: "local" }), complete: vi.fn().mockResolvedValue({ basisAmount: 100, basisUnit: "g", nutrients: { protein: 12 } }) } as unknown as OllamaProvider;

    await extractNutritionForName("Tofu", ["protein"], { search, ai, fetchSource: fetchSource as never });

    expect(fetchSource).toHaveBeenCalledTimes(3);
  });

  it("caps model attempts at two", async () => {
    const search = { search: async () => [1, 2, 3].map((n) => ({ title: `Food nutrition ${n}`, url: `https://${n}.test` })) } as unknown as SearxngClient;
    const ai = { capabilities: async () => ({ model: "local" }), complete: vi.fn().mockResolvedValue({ basisAmount: 100, basisUnit: "ml", nutrients: { protein: 2 } }) } as unknown as OllamaProvider;
    await expect(extractNutritionForName("Food", ["protein"], { search, ai, fetchSource: (async (url: string) => ({ url, excerpt: "Food nutrition per 100 g protein" })) as never })).resolves.toBeNull();
    expect(ai.complete).toHaveBeenCalledTimes(2);
  });
});

describe("provider failures during extraction", () => {
  const search = { search: async () => [{ title: "Tofu nutrition facts", url: "https://a.test" }] } as unknown as SearxngClient;
  const fetchSource = (async (url: string) => ({ url, excerpt: "Tofu nutrition per 100 g protein 12 g" })) as never;

  it("propagates an unreachable provider instead of reporting an empty result", async () => {
    // Swallowed, this reached `enrichFood` as "nothing found", which counts as
    // an attempt - and `enrichedAt` then withholds the food from the sweep for
    // a month over an outage rather than a fact about the food.
    const ai = { capabilities: async () => ({ model: "local" }), complete: vi.fn().mockRejectedValue(new AIUnavailableError("ollama", "Ollama is unreachable")) } as unknown as OllamaProvider;
    await expect(extractNutritionForName("Tofu", ["protein"], { search, ai, fetchSource })).rejects.toThrow(AIUnavailableError);
    expect(ai.complete).toHaveBeenCalledTimes(1);
  });

  it("still moves past a candidate the model answered badly", async () => {
    const ai = { capabilities: async () => ({ model: "local" }), complete: vi.fn().mockRejectedValue(new AIInvalidOutputError("nutrients: expected object")) } as unknown as OllamaProvider;
    await expect(extractNutritionForName("Tofu", ["protein"], { search, ai, fetchSource })).resolves.toBeNull();
  });
});

/** Both switches on and a configured SearXNG: the only state that permits a run. */
function allowResearch(consenting: string[]) {
  process.env.RESEARCH_ENABLED = "true";
  process.env.SEARXNG_URL = "http://searxng.test";
  userProfile.findMany.mockResolvedValue(consenting.map((userId) => ({ userId })));
}

describe("enrichment permission", () => {
  afterEach(() => {
    delete process.env.RESEARCH_ENABLED;
    delete process.env.SEARXNG_URL;
    vi.clearAllMocks();
  });

  it("refuses when the deployment switch is off, before asking anybody's consent", async () => {
    process.env.RESEARCH_ENABLED = "false";
    process.env.SEARXNG_URL = "http://searxng.test";
    expect(await enrichmentBlock({ ownerId: null }, "admin-1")).toBe("SERVER_DISABLED");
    // Decided before any database round trip: an air-gapped deployment answers
    // this without consulting a profile at all.
    expect(userProfile.findMany).not.toHaveBeenCalled();
  });

  it("refuses when no source discovery is configured, which used to look like success", async () => {
    process.env.RESEARCH_ENABLED = "true";
    delete process.env.SEARXNG_URL;
    // SearxngClient answers an unconfigured instance with an empty result, so
    // this used to complete as "nothing found" and stamp the food for a month.
    expect(await enrichmentBlock({ ownerId: null }, "admin-1")).toBe("NO_SEARCH_PROVIDER");
  });

  it("requires the consent of the user the job belongs to", async () => {
    allowResearch([]);
    expect(await enrichmentBlock({ ownerId: null }, "user-1")).toBe("USER_DECLINED");
    allowResearch(["user-1"]);
    expect(await enrichmentBlock({ ownerId: null }, "user-1")).toBeNull();
  });

  it("also requires the food owner's consent, not only the requester's", async () => {
    // The catalogue sweep runs as the admin but reaches foods somebody else owns.
    allowResearch(["admin-1"]);
    expect(await enrichmentBlock({ ownerId: "user-2" }, "admin-1")).toBe("USER_DECLINED");
    allowResearch(["admin-1", "user-2"]);
    expect(await enrichmentBlock({ ownerId: "user-2" }, "admin-1")).toBeNull();
  });

  it("keeps only the foods whose owner agreed when a batch is queued", async () => {
    allowResearch(["user-1"]);
    expect(await permittedForEnrichment([
      { id: "catalogue", ownerId: null },
      { id: "mine", ownerId: "user-1" },
      { id: "theirs", ownerId: "user-2" },
    ], "user-1")).toEqual(["catalogue", "mine"]);
  });

  it("queues nothing at all when the requester has not consented", async () => {
    allowResearch([]);
    expect(await permittedForEnrichment([{ id: "catalogue", ownerId: null }], "user-1")).toEqual([]);
  });

  it("treats an injected search client as configured, so tests need no variable", async () => {
    process.env.RESEARCH_ENABLED = "true";
    delete process.env.SEARXNG_URL;
    userProfile.findMany.mockResolvedValue([{ userId: "user-1" }]);
    const search = { search: vi.fn() } as unknown as SearxngClient;
    expect(await enrichmentBlock({ ownerId: null }, "user-1", { search })).toBeNull();
  });
});

describe("enrichFood", () => {
  beforeEach(() => {
    food.findUnique.mockResolvedValue({
      id: "food-1", name: "Käse", ownerId: null, basisUnit: "G", densityGPerMl: null,
      servingSize: 30, nutrients: [{ nutrientKey: "iron", value: null }], servings: [],
    });
    food.update.mockResolvedValue({});
    nutrientDefinition.findMany.mockResolvedValue([{ key: "iron", canonicalUnit: "mg" }]);
  });

  afterEach(() => {
    delete process.env.RESEARCH_ENABLED;
    delete process.env.SEARXNG_URL;
    vi.clearAllMocks();
  });

  it("refuses a food it may not research, without stamping it as attempted", async () => {
    process.env.RESEARCH_ENABLED = "false";
    await expect(enrichFood("food-1", "user-1")).rejects.toThrow("research-not-permitted:SERVER_DISABLED");
    // `enrichedAt` is what suppresses a food from the sweep for a month. A run
    // that was never permitted must not spend that.
    expect(food.update).not.toHaveBeenCalled();
  });

  it("leaves the food unstamped when the provider is down, so an outage costs no month", async () => {
    allowResearch(["user-1"]);
    const ai = { capabilities: vi.fn().mockRejectedValue(new AIUnavailableError("ollama", "ollama unreachable")) } as unknown as OllamaProvider;
    const search = { search: vi.fn(async () => [{ title: "Käse", url: "https://a.test" }]) } as unknown as SearxngClient;
    const fetchSource = vi.fn(async (url: string) => ({ url, title: "Käse", excerpt: "Eisen 0,4 mg pro 100 g", truncated: false }));
    await expect(enrichFood("food-1", "user-1", { ai, search, fetchSource })).rejects.toThrow("ollama unreachable");
    expect(food.update).not.toHaveBeenCalled();
  });

  it("stamps a genuine attempt that found nothing, so the sweep moves on", async () => {
    allowResearch(["user-1"]);
    const search = { search: vi.fn(async () => []) } as unknown as SearxngClient;
    await expect(enrichFood("food-1", "user-1", { search })).resolves.toEqual({ filledNutrientKeys: [], servingFilled: false });
    expect(food.update).toHaveBeenCalledWith({ where: { id: "food-1" }, data: { enrichedAt: expect.any(Date) } });
  });
});

describe("enrichFood: proposing versus applying", () => {
  /** A source that offers one value for the food's one gap. */
  const sourceOffering = (per100g: Record<string, number>) => ({
    ai: { capabilities: vi.fn(async () => ({ model: "qwen3.5:4b" })), complete: vi.fn(async () => ({ nutrients: per100g, basisAmount: 100, basisUnit: "g" })) } as unknown as OllamaProvider,
    search: { search: vi.fn(async () => [{ title: "Käse Nährwerte", url: "https://a.test" }]) } as unknown as SearxngClient,
    fetchSource: vi.fn(async (url: string) => ({ url, title: "Käse Nährwerte", excerpt: "Nährwerte pro 100 g: Eisen 0,4 mg", truncated: false })),
  });

  beforeEach(() => {
    food.findUnique.mockResolvedValue({
      id: "food-1", name: "Käse", ownerId: null, basisUnit: "G", densityGPerMl: null,
      servingSize: 30, nutrients: [{ nutrientKey: "iron", value: null }], servings: [],
    });
    food.update.mockResolvedValue({});
    nutrientDefinition.findMany.mockResolvedValue([{ key: "iron", canonicalUnit: "mg" }]);
    enrichmentProposal.create.mockResolvedValue({ id: "proposal-1" });
    foodNutrient.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    delete process.env.RESEARCH_ENABLED;
    delete process.env.SEARXNG_URL;
    vi.clearAllMocks();
  });

  it("records a proposal and touches no nutrient when review is required", async () => {
    allowResearch(["user-1"]);
    userProfile.findUnique.mockResolvedValue({ autoApplyEnrichment: false });

    const result = await enrichFood("food-1", "user-1", sourceOffering({ iron: 0.4 }));

    expect(foodNutrient.updateMany).not.toHaveBeenCalled();
    expect(foodNutrient.create).not.toHaveBeenCalled();
    expect(enrichmentProposalValue.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nutrientKey: "iron", status: "PENDING", applied: false }) }),
    );
    // Nothing reached the food, so the job reports what is waiting instead.
    expect(result.filledNutrientKeys).toEqual([]);
    expect(result.proposedKeys).toEqual(["iron"]);
  });

  it("writes straight through when the user has switched review off", async () => {
    allowResearch(["user-1"]);
    userProfile.findUnique.mockResolvedValue({ autoApplyEnrichment: true });

    const result = await enrichFood("food-1", "user-1", sourceOffering({ iron: 0.4 }));

    expect(foodNutrient.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ origin: "AI_ENRICHMENT" }) }),
    );
    expect(enrichmentProposalValue.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED", applied: true }) }),
    );
    expect(result.filledNutrientKeys).toEqual(["iron"]);
    expect(result.proposedKeys).toEqual([]);
  });

  it("keeps the keys it asked for on the proposal, answered or not", async () => {
    allowResearch(["user-1"]);
    userProfile.findUnique.mockResolvedValue({ autoApplyEnrichment: false });
    nutrientDefinition.findMany.mockResolvedValue([{ key: "iron" }, { key: "iodine" }]);
    food.findUnique.mockResolvedValue({
      id: "food-1", name: "Käse", ownerId: null, basisUnit: "G", densityGPerMl: null,
      servingSize: 30, nutrients: [{ nutrientKey: "iron", value: null }, { nutrientKey: "iodine", value: null }], servings: [],
    });

    // The source answers only one of the two gaps.
    await enrichFood("food-1", "user-1", sourceOffering({ iron: 0.4 }));

    // Both are recorded as asked, so a later run can move on to the untried one
    // instead of requesting the same window of the catalogue again.
    expect(enrichmentProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ requestedKeys: ["iron", "iodine"] }) }),
    );
  });
});
