/**
 * The tiered search: which sources are consulted, in what order, and when the
 * walk stops.
 *
 * The point of these tests is that tier order is an explicit orchestration
 * decision rather than a side effect of ranking, so they assert on the order
 * sources were *asked* - the `tiers` report and the provider call order - and
 * not merely on the results that came back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    searchQueryCache: { findUnique: vi.fn(), upsert: vi.fn() },
    food: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    favorite: { findMany: vi.fn() },
    foodUsageStats: { findMany: vi.fn() },
    recipe: { findMany: vi.fn() },
    foodNutrient: { deleteMany: vi.fn(), createMany: vi.fn() },
    foodServing: { deleteMany: vi.fn(), create: vi.fn() },
    foodSource: { deleteMany: vi.fn(), create: vi.fn() },
    externalFoodCache: { upsert: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { OpenFoodFactsProvider } from "@/providers/open-food-facts";
import { UsdaProvider } from "@/providers/usda";
import { FatSecretProvider } from "@/providers/fatsecret";
import { ProviderUnavailableError, type NormalizedFood } from "@/providers/food";
import { resetFoodSearchCooldowns, searchFoods } from "./foods";

/** A stored row, with only the fields the search reads. */
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "food-local",
  ownerId: null,
  name: "Hafer Flocken",
  normalizedName: "hafer flocken",
  brand: null,
  barcode: null,
  locale: "de",
  foodType: "GENERIC",
  sourceType: "OPEN_FOOD_FACTS",
  externalProvider: "OPEN_FOOD_FACTS",
  externalId: "x",
  basisAmount: 100,
  basisUnit: "G",
  servingSize: null,
  servingUnit: null,
  densityGPerMl: null,
  dataConfidence: 0.9,
  isEstimated: false,
  rawState: null,
  cacheExpiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  // Complete: all four primary nutrients, which is what lets a match end the
  // tier walk at all.
  nutrients: [
    { nutrientKey: "energyKcal", value: 348 },
    { nutrientKey: "protein", value: 13.2 },
    { nutrientKey: "carbohydrate", value: 53.3 },
    { nutrientKey: "fat", value: 6.65 },
  ],
  servings: [],
  translations: [],
  aliases: [],
  ...overrides,
});

/** The same food, but stating only energy: found, yet not enough to stop on. */
const incomplete = (overrides: Record<string, unknown> = {}) =>
  row({ nutrients: [{ nutrientKey: "energyKcal", value: 348 }], ...overrides });

/**
 * Answers each stored tier's query with its own rows.
 *
 * The tier a query belongs to is read off the source scope the search adds as
 * the third AND clause, which is the same thing PostgreSQL would use.
 */
function storedTiers(tiers: { local?: unknown[]; bls?: unknown[]; usda?: unknown[] }) {
  prismaMock.food.findMany.mockImplementation((args: { where?: { AND?: unknown[] } }) => {
    const scope = args?.where?.AND?.[2] as {
      sourceType?: { in: string[] };
      NOT?: { sourceType: { in: string[] } };
      OR?: { NOT?: unknown }[];
    };
    if (scope?.NOT || scope?.OR?.some((clause) => clause.NOT)) return Promise.resolve(tiers.local ?? []);
    const only = scope?.sourceType?.in ?? [];
    if (only.includes("BLS")) return Promise.resolve(tiers.bls ?? []);
    if (only.includes("USDA")) return Promise.resolve(tiers.usda ?? []);
    return Promise.resolve([]);
  });
}

/** Records the order network providers were asked in. */
function spyProviders() {
  const calls: string[] = [];
  const off = vi.spyOn(OpenFoodFactsProvider.prototype, "search").mockImplementation(async () => {
    calls.push("OPEN_FOOD_FACTS");
    return [];
  });
  const usda = vi.spyOn(UsdaProvider.prototype, "search").mockImplementation(async () => {
    calls.push("USDA");
    return [];
  });
  const fatSecret = vi.spyOn(FatSecretProvider.prototype, "search").mockImplementation(async () => {
    calls.push("FATSECRET");
    return [];
  });
  return { calls, off, usda, fatSecret };
}

const ENV_KEYS = [
  "BLS_ENABLED",
  "USDA_ENABLED",
  "OPENFOODFACTS_ENABLED",
  "FATSECRET_ENABLED",
  "USDA_API_KEY",
  "FATSECRET_CLIENT_ID",
  "FATSECRET_CLIENT_SECRET",
] as const;
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

/** Every source configured, so a test measures order and not this machine. */
function enableEverySource() {
  process.env.BLS_ENABLED = "true";
  process.env.USDA_ENABLED = "true";
  process.env.OPENFOODFACTS_ENABLED = "true";
  process.env.USDA_API_KEY = "test-key";
  process.env.FATSECRET_ENABLED = "true";
  process.env.FATSECRET_CLIENT_ID = "test-id";
  process.env.FATSECRET_CLIENT_SECRET = "test-secret";
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  // A deliberate outage in one test must not silence a provider in the next.
  resetFoodSearchCooldowns();
  prismaMock.favorite.findMany.mockResolvedValue([]);
  prismaMock.foodUsageStats.findMany.mockResolvedValue([]);
  prismaMock.food.findMany.mockResolvedValue([]);
  prismaMock.food.findFirst.mockResolvedValue(null);
  prismaMock.searchQueryCache.findUnique.mockResolvedValue(null);
  prismaMock.searchQueryCache.upsert.mockResolvedValue({});
  enableEverySource();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

const search = (overrides: Record<string, unknown> = {}) =>
  searchFoods({ userId: "user-1", query: "Hafer", locale: "de", includeRemote: true, ...overrides });

const consulted = (outcome: Awaited<ReturnType<typeof searchFoods>>) => outcome.tiers.map((tier) => tier.source);

describe("German text search", () => {
  it("consults local, BLS, Open Food Facts, FatSecret and USDA, in that order", async () => {
    storedTiers({});
    const { calls } = spyProviders();

    const outcome = await search();

    expect(consulted(outcome)).toEqual(["LOCAL", "BLS", "OPEN_FOOD_FACTS", "FATSECRET", "USDA"]);
    // And the network ones really were asked in that order, not merely listed.
    expect(calls).toEqual(["OPEN_FOOD_FACTS", "FATSECRET", "USDA"]);
  });

  it("searches BLS from the local store, with no network request", async () => {
    storedTiers({ bls: [row({ id: "bls-1", sourceType: "BLS" })] });
    const { calls } = spyProviders();

    // No remote opt-in at all: BLS is local, so it still answers.
    const outcome = await search({ includeRemote: false });

    expect(outcome.results.map((result) => result.id)).toContain("bls-1");
    expect(calls).toEqual([]);
    expect(outcome.remoteAttempted).toBe(false);
  });
});

describe("English text search", () => {
  it("consults local, USDA, Open Food Facts and FatSecret, in that order", async () => {
    storedTiers({});
    const { calls } = spyProviders();

    const outcome = await search({ locale: "en" });

    expect(consulted(outcome)).toEqual(["LOCAL", "USDA", "OPEN_FOOD_FACTS", "FATSECRET"]);
    expect(calls).toEqual(["USDA", "OPEN_FOOD_FACTS", "FATSECRET"]);
  });

  it("never consults BLS for an English search", async () => {
    storedTiers({ bls: [row({ id: "bls-1", sourceType: "BLS" })] });
    spyProviders();

    const outcome = await search({ locale: "en" });

    expect(consulted(outcome)).not.toContain("BLS");
    expect(outcome.results.map((result) => result.id)).not.toContain("bls-1");
  });
});

describe("when the walk stops", () => {
  it("a strong, complete BLS hit spares Open Food Facts, FatSecret and USDA", async () => {
    // An exact name match with all four primary nutrients: the whole reason
    // the German tier order puts BLS before the network.
    storedTiers({ bls: [row({ id: "bls-1", sourceType: "BLS", name: "Hafer", normalizedName: "hafer" })] });
    const { calls } = spyProviders();

    const outcome = await search();

    expect(calls).toEqual([]);
    expect(outcome.remoteAttempted).toBe(false);
    const skipped = outcome.tiers.filter((tier) => tier.skipped === "sufficient-result").map((tier) => tier.source);
    expect(skipped).toEqual(["OPEN_FOOD_FACTS", "FATSECRET", "USDA"]);
  });

  it("an incomplete BLS hit still falls through to Open Food Facts", async () => {
    // Same exact name, but only energy. Found is not the same as answered.
    storedTiers({
      bls: [incomplete({ id: "bls-1", sourceType: "BLS", name: "Hafer", normalizedName: "hafer" })],
    });
    const { calls } = spyProviders();

    const outcome = await search();

    expect(calls).toContain("OPEN_FOOD_FACTS");
    expect(outcome.remoteAttempted).toBe(true);
    // The weak result is not thrown away, it just did not end the search.
    expect(outcome.results.map((result) => result.id)).toContain("bls-1");
  });

  it("a merely similar BLS name does not stop the walk", async () => {
    // "Nutella" against a generic nut spread: complete, but not the food asked
    // for. If similarity ended the traversal, no branded product would be found.
    storedTiers({
      bls: [row({ id: "bls-1", sourceType: "BLS", name: "Nuss-Nougat-Creme", normalizedName: "nuss nougat creme" })],
    });
    const { calls } = spyProviders();

    await search({ query: "Nutella" });

    expect(calls).toContain("OPEN_FOOD_FACTS");
  });

  it("a strong local hit spares every network source", async () => {
    storedTiers({ local: [row({ id: "local-1", name: "Hafer", normalizedName: "hafer" })] });
    const { calls } = spyProviders();

    const outcome = await search();

    expect(calls).toEqual([]);
    expect(outcome.tiers.find((tier) => tier.source === "BLS")?.skipped).toBe("sufficient-result");
  });

  it("does not touch the network while somebody is typing", async () => {
    storedTiers({});
    const { calls } = spyProviders();

    const outcome = await search({ includeRemote: false });

    expect(calls).toEqual([]);
    const reasons = outcome.tiers.filter((tier) => tier.skipped).map((tier) => tier.skipped);
    expect(reasons).toEqual(["remote-not-requested", "remote-not-requested", "remote-not-requested"]);
  });
});

describe("a source that is unavailable", () => {
  it("does not stop the sources after it", async () => {
    storedTiers({});
    const calls: string[] = [];
    vi.spyOn(OpenFoodFactsProvider.prototype, "search").mockRejectedValue(
      new ProviderUnavailableError("OPEN_FOOD_FACTS", "down", undefined, "TIMEOUT"),
    );
    vi.spyOn(FatSecretProvider.prototype, "search").mockImplementation(async () => {
      calls.push("FATSECRET");
      return [];
    });
    vi.spyOn(UsdaProvider.prototype, "search").mockImplementation(async () => {
      calls.push("USDA");
      return [];
    });

    const outcome = await search();

    expect(calls).toEqual(["FATSECRET", "USDA"]);
    expect(outcome.tiers.find((tier) => tier.source === "OPEN_FOOD_FACTS")?.failed).toBe(true);
    expect(outcome.providerError).toMatchObject({ provider: "OPEN_FOOD_FACTS", reason: "TIMEOUT" });
  });

  it("keeps the results the earlier tiers already found", async () => {
    storedTiers({ bls: [incomplete({ id: "bls-1", sourceType: "BLS" })] });
    vi.spyOn(OpenFoodFactsProvider.prototype, "search").mockRejectedValue(
      new ProviderUnavailableError("OPEN_FOOD_FACTS", "down"),
    );
    vi.spyOn(FatSecretProvider.prototype, "search").mockResolvedValue([]);
    vi.spyOn(UsdaProvider.prototype, "search").mockResolvedValue([]);

    const outcome = await search();

    expect(outcome.results.map((result) => result.id)).toEqual(["bls-1"]);
  });

  it("reports the first failure rather than the last", async () => {
    storedTiers({});
    vi.spyOn(OpenFoodFactsProvider.prototype, "search").mockRejectedValue(
      new ProviderUnavailableError("OPEN_FOOD_FACTS", "rate limited", undefined, "RATE_LIMITED", 30),
    );
    vi.spyOn(FatSecretProvider.prototype, "search").mockRejectedValue(
      new ProviderUnavailableError("FATSECRET", "down", undefined, "NETWORK"),
    );
    vi.spyOn(UsdaProvider.prototype, "search").mockResolvedValue([]);

    const outcome = await search();

    expect(outcome.providerError).toMatchObject({ provider: "OPEN_FOOD_FACTS", retryAfterSeconds: 30 });
    expect(outcome.tiers.filter((tier) => tier.failed).map((tier) => tier.source)).toEqual([
      "OPEN_FOOD_FACTS",
      "FATSECRET",
    ]);
  });
});

describe("barcode lookup", () => {
  const BARCODE = "4000000000001";

  it("goes local, then Open Food Facts, then FatSecret", async () => {
    storedTiers({});
    const off = vi.spyOn(OpenFoodFactsProvider.prototype, "getByBarcode").mockResolvedValue(null);
    const fatSecret = vi.spyOn(FatSecretProvider.prototype, "getByBarcode").mockResolvedValue(null);

    const outcome = await searchFoods({ userId: "user-1", query: BARCODE, locale: "de" });

    expect(consulted(outcome)).toEqual(["LOCAL", "OPEN_FOOD_FACTS", "FATSECRET"]);
    expect(off).toHaveBeenCalledWith(BARCODE);
    expect(fatSecret).toHaveBeenCalledWith(BARCODE);
  });

  it("never asks BLS or the USDA generic search for a barcode", async () => {
    storedTiers({});
    const usdaSearch = vi.spyOn(UsdaProvider.prototype, "search").mockResolvedValue([]);
    const usdaBarcode = vi.spyOn(UsdaProvider.prototype, "getByBarcode").mockResolvedValue(null);
    vi.spyOn(OpenFoodFactsProvider.prototype, "getByBarcode").mockResolvedValue(null);
    vi.spyOn(FatSecretProvider.prototype, "getByBarcode").mockResolvedValue(null);

    const outcome = await searchFoods({ userId: "user-1", query: BARCODE, locale: "de" });

    expect(consulted(outcome)).not.toContain("BLS");
    expect(consulted(outcome)).not.toContain("USDA");
    expect(usdaSearch).not.toHaveBeenCalled();
    expect(usdaBarcode).not.toHaveBeenCalled();
    // And no tier queried the BLS rows either.
    const scopes = prismaMock.food.findMany.mock.calls.map((call) => JSON.stringify(call[0]?.where?.AND?.[2]));
    expect(scopes.some((scope) => scope?.includes('"BLS"') && !scope.includes("NOT"))).toBe(false);
  });

  it("answers from the local store without asking any provider", async () => {
    storedTiers({ local: [row({ id: "local-1", barcode: BARCODE })] });
    const off = vi.spyOn(OpenFoodFactsProvider.prototype, "getByBarcode").mockResolvedValue(null);

    const outcome = await searchFoods({ userId: "user-1", query: BARCODE, locale: "de" });

    expect(outcome.results.map((result) => result.id)).toEqual(["local-1"]);
    expect(off).not.toHaveBeenCalled();
  });

  it("still works with Open Food Facts alone when FatSecret is off", async () => {
    process.env.FATSECRET_ENABLED = "false";
    storedTiers({});
    const off = vi.spyOn(OpenFoodFactsProvider.prototype, "getByBarcode").mockResolvedValue(null);
    const fatSecret = vi.spyOn(FatSecretProvider.prototype, "getByBarcode").mockResolvedValue(null);

    const outcome = await searchFoods({ userId: "user-1", query: BARCODE, locale: "de" });

    expect(consulted(outcome)).toEqual(["LOCAL", "OPEN_FOOD_FACTS"]);
    expect(off).toHaveBeenCalled();
    expect(fatSecret).not.toHaveBeenCalled();
  });
});

describe("an installation that configures nothing new", () => {
  it("behaves exactly as before when FatSecret is off", async () => {
    process.env.FATSECRET_ENABLED = "false";
    storedTiers({});
    const { calls, fatSecret } = spyProviders();

    const outcome = await search();

    expect(consulted(outcome)).toEqual(["LOCAL", "BLS", "OPEN_FOOD_FACTS", "USDA"]);
    expect(fatSecret).not.toHaveBeenCalled();
    expect(calls).toEqual(["OPEN_FOOD_FACTS", "USDA"]);
  });

  it("searches the bundled USDA data but not the API when no key is set", async () => {
    delete process.env.USDA_API_KEY;
    storedTiers({ usda: [incomplete({ id: "usda-1", sourceType: "USDA", locale: "en" })] });
    const { calls } = spyProviders();

    const outcome = await search({ locale: "en" });

    // The stored half answered; the network half reported itself unconfigured.
    expect(outcome.results.map((result) => result.id)).toContain("usda-1");
    expect(calls).not.toContain("USDA");
    expect(outcome.tiers.find((tier) => tier.source === "USDA")?.skipped).toBe("not-configured");
  });

  it("works with every optional source turned off", async () => {
    process.env.FATSECRET_ENABLED = "false";
    process.env.USDA_ENABLED = "false";
    storedTiers({ bls: [row({ id: "bls-1", sourceType: "BLS" })] });
    const { calls } = spyProviders();

    const outcome = await search();

    expect(consulted(outcome)).toEqual(["LOCAL", "BLS", "OPEN_FOOD_FACTS"]);
    expect(outcome.results.map((result) => result.id)).toContain("bls-1");
    expect(calls).toEqual(["OPEN_FOOD_FACTS"]);
  });
});

describe("finding a BLS food in either language", () => {
  it("asks the database for the name, the aliases and the translations", async () => {
    storedTiers({});
    spyProviders();

    await search({ query: "oat flakes" });

    const textClause = prismaMock.food.findMany.mock.calls[0][0].where.AND[1].OR;
    expect(textClause).toEqual(
      expect.arrayContaining([
        { aliases: { some: { name: { contains: "oat flakes", mode: "insensitive" } } } },
        { translations: { some: { normalizedName: { contains: "oat flakes" } } } },
      ]),
    );
  });

  it("treats an exact English translation of a German food as an identity match", async () => {
    storedTiers({
      bls: [
        row({
          id: "bls-1",
          sourceType: "BLS",
          name: "Hafer Flocken",
          normalizedName: "hafer flocken",
          translations: [{ locale: "en", name: "Oat flakes", normalizedName: "oat flakes" }],
        }),
      ],
    });
    const { calls } = spyProviders();

    // A German-locale user typing the English name: the official translation
    // is an identity match, so the walk ends without a network request.
    const outcome = await search({ query: "Oat flakes" });

    expect(calls).toEqual([]);
    expect(outcome.results.map((result) => result.id)).toEqual(["bls-1"]);
  });

  it("keeps a BLS food an English user has eaten, and shows its English name", async () => {
    // BLS is not an English *tier* - USDA takes that place - but a food this
    // person has logged is local by definition, whatever database it came from.
    const bls = row({
      id: "bls-1",
      sourceType: "BLS",
      name: "Hafer Flocken",
      normalizedName: "hafer flocken",
      translations: [{ locale: "en", name: "Oat flakes", normalizedName: "oat flakes" }],
    });
    prismaMock.foodUsageStats.findMany.mockResolvedValue([
      { foodId: "bls-1", count: 4, lastUsedAt: new Date(), usualMeals: [] },
    ]);
    storedTiers({ local: [bls] });
    const { calls } = spyProviders();

    const outcome = await search({ query: "Oat flakes", locale: "en" });

    expect(outcome.results[0]).toMatchObject({ id: "bls-1", name: "Oat flakes" });
    expect(calls).toEqual([]);
    // And the local tier's query really did offer to include it.
    const scope = prismaMock.food.findMany.mock.calls[0][0].where.AND[2];
    expect(scope.OR).toEqual(
      expect.arrayContaining([{ id: { in: ["bls-1"] } }]),
    );
  });

  it("treats an exact synonym as an identity match", async () => {
    storedTiers({
      bls: [
        row({
          id: "bls-1",
          sourceType: "BLS",
          name: "Speisesalz/Siedesalz/Tafelsalz",
          normalizedName: "speisesalz siedesalz tafelsalz",
          aliases: [{ name: "Tafelsalz", locale: "de" }],
        }),
      ],
    });
    const { calls } = spyProviders();

    const outcome = await search({ query: "Tafelsalz" });

    expect(calls).toEqual([]);
    expect(outcome.results.map((result) => result.id)).toEqual(["bls-1"]);
  });
});

describe("privacy", () => {
  it("scopes every tier's query to public foods and the caller's own", async () => {
    storedTiers({});
    spyProviders();

    await search({ locale: "de" });

    const scopeQueries = prismaMock.food.findMany.mock.calls;
    expect(scopeQueries.length).toBeGreaterThan(1);
    for (const [args] of scopeQueries) {
      // Held in an AND beside the text match, never spread beside it, which is
      // what would silently replace it and expose other users' private foods.
      expect(args.where.AND[0]).toEqual({ OR: [{ ownerId: null }, { ownerId: "user-1" }] });
    }
  });
});

describe("ranking stays deterministic", () => {
  it("orders the same candidates identically every time", async () => {
    const candidates = [
      row({ id: "a", name: "Hafer Flocken", normalizedName: "hafer flocken" }),
      row({ id: "b", name: "Hafer", normalizedName: "hafer" }),
      row({ id: "c", name: "Haferkleie", normalizedName: "haferkleie" }),
    ];
    const orders: string[][] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      vi.clearAllMocks();
      prismaMock.favorite.findMany.mockResolvedValue([]);
      prismaMock.foodUsageStats.findMany.mockResolvedValue([]);
      storedTiers({ local: candidates });
      spyProviders();
      const outcome = await search({ includeRemote: false });
      orders.push(outcome.results.map((result) => result.id));
    }
    expect(new Set(orders.map((order) => order.join(",")))).toHaveProperty("size", 1);
  });

  it("puts a barcode match above every scored candidate", async () => {
    const barcode = "4000000000001";
    storedTiers({
      local: [
        row({ id: "scored", name: "Hafer", normalizedName: "hafer" }),
        row({ id: "scanned", barcode, name: "Etwas anderes", normalizedName: "etwas anderes" }),
      ],
    });
    vi.spyOn(OpenFoodFactsProvider.prototype, "getByBarcode").mockResolvedValue(null);
    vi.spyOn(FatSecretProvider.prototype, "getByBarcode").mockResolvedValue(null);

    const outcome = await searchFoods({ userId: "user-1", query: barcode, locale: "de" });

    expect(outcome.results[0].id).toBe("scanned");
  });
});

describe("results a source returns", () => {
  it("drops a remote product that arrived without an energy value", async () => {
    storedTiers({});
    const product: NormalizedFood = {
      externalId: "x1",
      name: "Hafer",
      basisAmount: 100,
      basisUnit: "G",
      nutrients: { energyKcal: null, protein: 3 },
      provenance: { provider: "OPEN_FOOD_FACTS", retrievedAt: new Date(), estimated: false },
    };
    vi.spyOn(OpenFoodFactsProvider.prototype, "search").mockResolvedValue([product]);
    vi.spyOn(FatSecretProvider.prototype, "search").mockResolvedValue([]);
    vi.spyOn(UsdaProvider.prototype, "search").mockResolvedValue([]);
    prismaMock.food.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockResolvedValue([]);
    const stored = row({ id: "remote-1", nutrients: [{ nutrientKey: "protein", value: 3 }] });
    prismaMock.food.create.mockResolvedValue(stored);
    prismaMock.food.findUniqueOrThrow.mockResolvedValue(stored);

    const outcome = await search();

    expect(outcome.results).toEqual([]);
  });
});
