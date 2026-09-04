/**
 * Provider-specific persistence: what is written when a source answers, and
 * what is later removed again.
 *
 * The rule this file exists to protect: Open Food Facts and USDA content may
 * become a permanent local row, and FatSecret content may not. Applying Open
 * Food Facts' rules to FatSecret would quietly build the copy of their
 * database their terms do not allow, and nothing in the UI would show it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    food: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    foodNutrient: { deleteMany: vi.fn(), createMany: vi.fn() },
    foodServing: { deleteMany: vi.fn(), create: vi.fn() },
    foodSource: { deleteMany: vi.fn(), create: vi.fn() },
    externalFoodCache: { upsert: vi.fn() },
    searchQueryCache: { findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { FOOD_SOURCES } from "@/providers/food-sources";
import type { NormalizedFood } from "@/providers/food";
import { pruneExpiredProviderFoods, upsertProviderFood } from "./foods";

const product = (overrides: Partial<NormalizedFood> = {}): NormalizedFood => ({
  externalId: "33691",
  name: "Banana",
  basisAmount: 100,
  basisUnit: "G",
  nutrients: { energyKcal: 89, protein: 1.09, carbohydrate: 22.8, fat: 0.33 },
  provenance: { provider: "FATSECRET", providerId: "33691", retrievedAt: new Date(), estimated: false },
  ...overrides,
});

const storedRow = {
  id: "food-1",
  name: "Banana",
  brand: null,
  barcode: null,
  sourceType: "FATSECRET",
  externalProvider: "FATSECRET",
  externalId: "33691",
  basisAmount: 100,
  basisUnit: "G",
  servingSize: null,
  servingUnit: null,
  densityGPerMl: null,
  isEstimated: false,
  nutrients: [],
  servings: [],
  translations: [],
  aliases: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.food.findUnique.mockResolvedValue(null);
  prismaMock.food.findFirst.mockResolvedValue(null);
  prismaMock.food.create.mockResolvedValue(storedRow);
  prismaMock.food.findUniqueOrThrow.mockResolvedValue(storedRow);
  prismaMock.$transaction.mockResolvedValue([]);
});

const createdFood = () => prismaMock.food.create.mock.calls[0][0].data;
const cachedContent = () => prismaMock.externalFoodCache.upsert.mock.calls[0][0];

describe("a source whose content may be kept", () => {
  it("stores an Open Food Facts product with no expiry", async () => {
    await upsertProviderFood(
      product({ provenance: { provider: "OPEN_FOOD_FACTS", retrievedAt: new Date(), estimated: false } }),
      "de",
      FOOD_SOURCES.OPEN_FOOD_FACTS,
    );

    expect(createdFood().cacheExpiresAt).toBeNull();
    expect(createdFood().sourceType).toBe("OPEN_FOOD_FACTS");
  });

  it("keeps the Open Food Facts content cache at a week, as before", async () => {
    const before = Date.now();
    await upsertProviderFood(
      product({ provenance: { provider: "OPEN_FOOD_FACTS", retrievedAt: new Date(), estimated: false } }),
      "de",
      FOOD_SOURCES.OPEN_FOOD_FACTS,
    );

    const expiresAt = (cachedContent().create.expiresAt as Date).getTime();
    expect(expiresAt - before).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
    expect(expiresAt - before).toBeLessThan(7.1 * 24 * 60 * 60 * 1000);
  });

  it("stores a USDA food permanently, because the data is public domain", async () => {
    await upsertProviderFood(
      product({ provenance: { provider: "USDA_FDC", retrievedAt: new Date(), estimated: false } }),
      "en",
      FOOD_SOURCES.USDA,
    );

    expect(createdFood().cacheExpiresAt).toBeNull();
    expect(createdFood().sourceType).toBe("USDA");
  });
});

describe("a source whose content may only be cached", () => {
  it("stamps a FatSecret food with an expiry", async () => {
    const before = Date.now();
    await upsertProviderFood(product(), "de", FOOD_SOURCES.FATSECRET);

    const expiry = createdFood().cacheExpiresAt as Date;
    expect(expiry).toBeInstanceOf(Date);
    expect(expiry.getTime() - before).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(expiry.getTime() - before).toBeLessThan(25 * 60 * 60 * 1000);
  });

  it("does not apply Open Food Facts' timings to it", async () => {
    await upsertProviderFood(product(), "de", FOOD_SOURCES.FATSECRET);

    const expiresAt = (cachedContent().create.expiresAt as Date).getTime();
    // A day, not the week Open Food Facts gets.
    expect(expiresAt - Date.now()).toBeLessThan(2 * 24 * 60 * 60 * 1000);
  });

  it("records it as FatSecret rather than as a generic import", async () => {
    await upsertProviderFood(product(), "de", FOOD_SOURCES.FATSECRET);
    expect(createdFood().sourceType).toBe("FATSECRET");
  });

  it("still keeps full provenance, so the row stays identifiable", async () => {
    await upsertProviderFood(product(), "de", FOOD_SOURCES.FATSECRET);
    const source = prismaMock.foodSource.create.mock.calls[0][0].data;
    expect(source).toMatchObject({ provider: "FATSECRET", providerId: "33691" });
  });
});

describe("a source whose content may not be stored at all", () => {
  it("refuses to write it rather than storing it quietly", async () => {
    // No shipped source is REFERENCE_ONLY. Honouring it needs a transient
    // result path the UI does not have, so it fails loudly instead of doing
    // the one thing the policy forbids.
    const referenceOnly = {
      ...FOOD_SOURCES.FATSECRET,
      cache: { ...FOOD_SOURCES.FATSECRET.cache, persistence: "REFERENCE_ONLY" as const },
    };

    await expect(upsertProviderFood(product(), "de", referenceOnly)).rejects.toThrow(/must not be stored/);
    expect(prismaMock.food.create).not.toHaveBeenCalled();
  });
});

describe("pruning what has expired", () => {
  it("only removes an expired food nothing refers to", async () => {
    prismaMock.food.deleteMany.mockResolvedValue({ count: 3 });
    const now = new Date("2026-09-04T12:00:00.000Z");

    const removed = await pruneExpiredProviderFoods(now);

    expect(removed).toBe(3);
    expect(prismaMock.food.deleteMany).toHaveBeenCalledWith({
      where: {
        cacheExpiresAt: { lt: now },
        // A diary entry, a favourite or a recipe is the user's relationship
        // with the food, not the provider's, so it keeps the row alive.
        diaryEntries: { none: {} },
        favorites: { none: {} },
        recipeIngredients: { none: {} },
      },
    });
  });

  it("never touches a food with no expiry", async () => {
    prismaMock.food.deleteMany.mockResolvedValue({ count: 0 });
    await pruneExpiredProviderFoods(new Date());
    // `cacheExpiresAt: { lt: … }` cannot match NULL in PostgreSQL, which is
    // what makes every permanent food - user, recipe, BLS, USDA, OFF - safe.
    const where = prismaMock.food.deleteMany.mock.calls[0][0].where;
    expect(where.cacheExpiresAt).toHaveProperty("lt");
  });
});

describe("the default is the source that was always there", () => {
  it("treats a call with no source as Open Food Facts, as before", async () => {
    await upsertProviderFood(
      product({ provenance: { provider: "OPEN_FOOD_FACTS", retrievedAt: new Date(), estimated: false } }),
      "de",
    );
    expect(createdFood().sourceType).toBe("OPEN_FOOD_FACTS");
    expect(createdFood().cacheExpiresAt).toBeNull();
    // And a product that says nothing about its kind is still a packaged one.
    expect(createdFood().foodType).toBe("PACKAGED");
  });

  it("respects a food type the source does state", async () => {
    await upsertProviderFood(
      product({
        foodType: "RAW",
        provenance: { provider: "USDA_FDC", retrievedAt: new Date(), estimated: false },
      }),
      "en",
      FOOD_SOURCES.USDA,
    );
    // A raw apple from USDA must not be stored as a packaged product.
    expect(createdFood().foodType).toBe("RAW");
  });
});
