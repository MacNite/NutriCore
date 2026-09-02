import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, searchQueryCache } = vi.hoisted(() => {
  const searchQueryCache = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  };
  return { searchQueryCache, prismaMock: {
    searchQueryCache,
    food: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    favorite: { findMany: vi.fn() },
    foodUsageStats: { findMany: vi.fn() },
    recipe: { findMany: vi.fn() },
    foodNutrient: { deleteMany: vi.fn(), createMany: vi.fn() },
    foodServing: { deleteMany: vi.fn(), create: vi.fn() },
    foodSource: { deleteMany: vi.fn(), create: vi.fn() },
    externalFoodCache: { upsert: vi.fn() },
    $transaction: vi.fn(),
  }};
});

const foodRow = {
  id: "food-1", ownerId: null, name: "Müller Milchreis Original", normalizedName: "muller milchreis original",
  brand: "Müller", barcode: "4000000000001", locale: "de", foodType: "PACKAGED", sourceType: "OPEN_FOOD_FACTS",
  externalProvider: "OPEN_FOOD_FACTS", externalId: "4000000000001", basisAmount: 100, basisUnit: "G",
  servingSize: 200, servingUnit: "g", densityGPerMl: null, dataConfidence: 0.9, isEstimated: false,
  rawState: null, createdAt: new Date(), updatedAt: new Date(),
  nutrients: [{ nutrientKey: "energyKcal", value: 120 }], servings: [],
};

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

import { OpenFoodFactsProvider } from "@/providers/open-food-facts";
import { ProviderUnavailableError } from "@/providers/food";
import { fetchRemote, hasIdentityMatch, hasStrongLocalMatch, searchFoods, upsertProviderFood } from "./foods";

const cachedProduct = {
  externalId: "4000000000001", barcode: "4000000000001", name: "Müller Milchreis Original", brand: "Müller",
  basisAmount: 100, basisUnit: "G", nutrients: { energyKcal: 120 },
  provenance: { provider: "OPEN_FOOD_FACTS", retrievedAt: new Date().toISOString(), estimated: false },
};

const cacheRow = (expiresAt: Date) => ({
  id: "cache-1", provider: "OPEN_FOOD_FACTS", queryKey: "milchreis",
  results: [cachedProduct], expiresAt, createdAt: new Date(),
});

describe("draft recipe search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.favorite.findMany.mockResolvedValue([]);
    prismaMock.foodUsageStats.findMany.mockResolvedValue([]);
    prismaMock.food.findMany.mockResolvedValue([]);
    prismaMock.recipe.findMany.mockResolvedValue([{ id: "draft-1", name: "Apfelkuchen", _count: { ingredients: 3 } }]);
  });

  it("returns matching drafts scoped to their owner when explicitly requested", async () => {
    const outcome = await searchFoods({ userId: "owner-1", query: "Apfel", locale: "de", includeRecipeDrafts: true });
    expect(outcome.recipeDrafts).toEqual([{ id: "draft-1", name: "Apfelkuchen", ingredientCount: 3 }]);
    expect(prismaMock.recipe.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId: "owner-1", status: "DRAFT", name: { contains: "Apfel", mode: "insensitive" } },
      take: 5,
    }));
  });

  it("never queries or leaks drafts into the default food/ingredient path", async () => {
    const outcome = await searchFoods({ userId: "owner-1", query: "Apfel", locale: "de" });
    expect(prismaMock.recipe.findMany).not.toHaveBeenCalled();
    expect(outcome.recipeDrafts).toEqual([]);
  });
});

describe("food search visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.favorite.findMany.mockResolvedValue([]);
    prismaMock.foodUsageStats.findMany.mockResolvedValue([]);
    prismaMock.food.findMany.mockResolvedValue([]);
    // A barcode query is answered from the local store, never from the network.
    prismaMock.food.findFirst.mockResolvedValue(foodRow);
  });

  it("keeps a text search inside the public and own foods", async () => {
    await searchFoods({ userId: "owner-1", query: "Banane", locale: "de" });

    const { where } = prismaMock.food.findMany.mock.calls[0][0];
    expect(where.AND[0]).toEqual({ OR: [{ ownerId: null }, { ownerId: "owner-1" }] });
    expect(where.AND[1].OR).toEqual(expect.arrayContaining([{ name: { contains: "banane", mode: "insensitive" } }]));
  });

  it("keeps a barcode search inside the public and own foods", async () => {
    await searchFoods({ userId: "owner-1", query: "4000000000001", locale: "de" });

    const { where } = prismaMock.food.findMany.mock.calls[0][0];
    expect(where.AND[0]).toEqual({ OR: [{ ownerId: null }, { ownerId: "owner-1" }] });
    expect(where.AND[1]).toEqual({ barcode: "4000000000001" });
  });

  it("returns an active recipe as a searchable food item", async () => {
    prismaMock.food.findMany.mockResolvedValue([{
      ...foodRow,
      id: "recipe-food-1",
      ownerId: "owner-1",
      name: "Apfelkuchen",
      normalizedName: "apfelkuchen",
      foodType: "RECIPE",
      sourceType: "RECIPE",
      externalProvider: "NUTRICORE_RECIPE",
      externalId: "recipe-1",
    }]);

    const outcome = await searchFoods({ userId: "owner-1", query: "Apfel", locale: "de" });

    expect(outcome.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "recipe-food-1", name: "Apfelkuchen", sourceType: "RECIPE", recipeId: "recipe-1" }),
    ]));
  });
});

describe("remote food search cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchQueryCache.findUnique.mockResolvedValue(null);
    prismaMock.food.findUnique.mockResolvedValue(null);
    prismaMock.food.findFirst.mockResolvedValue(null);
    prismaMock.food.create.mockResolvedValue(foodRow);
    prismaMock.food.update.mockResolvedValue(foodRow);
    prismaMock.food.findUniqueOrThrow.mockResolvedValue(foodRow);
    prismaMock.$transaction.mockResolvedValue([]);
  });

  it("does not cache an empty provider result", async () => {
    const search = vi.spyOn(OpenFoodFactsProvider.prototype, "search").mockResolvedValue([]);

    await expect(fetchRemote("unknown product", null, "de")).resolves.toEqual([]);

    expect(search).toHaveBeenCalledWith("unknown product", { limit: 25, locale: "de" });
    expect(searchQueryCache.upsert).not.toHaveBeenCalled();
  });

  it("serves an expired cached answer when the provider is down", async () => {
    // The data was right yesterday; an error banner would be worse than stale.
    searchQueryCache.findUnique.mockResolvedValue(cacheRow(new Date(Date.now() - 60_000)));
    const search = vi
      .spyOn(OpenFoodFactsProvider.prototype, "search")
      .mockRejectedValue(new ProviderUnavailableError("OPEN_FOOD_FACTS", "down", undefined, "HTTP_ERROR"));
    prismaMock.food.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(foodRow);

    await expect(fetchRemote("Milchreis", null, "de")).resolves.toMatchObject([{ id: "food-1" }]);
    expect(search).toHaveBeenCalled();
    expect(searchQueryCache.upsert).not.toHaveBeenCalled();
  });

  it("propagates the outage when nothing was ever cached for the query", async () => {
    searchQueryCache.findUnique.mockResolvedValue(null);
    vi.spyOn(OpenFoodFactsProvider.prototype, "search")
      .mockRejectedValue(new ProviderUnavailableError("OPEN_FOOD_FACTS", "down", undefined, "HTTP_ERROR"));

    await expect(fetchRemote("etwas ganz neues", null, "de")).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("does not call the provider again while a fresh answer is cached", async () => {
    searchQueryCache.findUnique.mockResolvedValue(cacheRow(new Date(Date.now() + 60_000)));
    const search = vi.spyOn(OpenFoodFactsProvider.prototype, "search");
    prismaMock.food.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(foodRow);

    await expect(fetchRemote("Milchreis", null, "de")).resolves.toHaveLength(1);
    expect(search).not.toHaveBeenCalled();
  });

  it("persists provider identity, nutrition, serving and provenance", async () => {
    prismaMock.food.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(foodRow);
    const product = {
      externalId: "4000000000001", barcode: "4000000000001", name: "Müller Milchreis Original", brand: "Müller",
      basisAmount: 100, basisUnit: "G" as const, servingAmount: 200, servingUnit: "g", servingLabel: "Becher (200 g)",
      nutrients: { energyKcal: 120, protein: 3 },
      provenance: { provider: "OPEN_FOOD_FACTS", providerId: "4000000000001", retrievedAt: new Date(), url: "https://world.openfoodfacts.org/product/4000000000001", estimated: false },
    };

    await expect(upsertProviderFood(product, "de")).resolves.toMatchObject({ id: "food-1", sourceType: "OPEN_FOOD_FACTS" });
    expect(prismaMock.food.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      sourceType: "OPEN_FOOD_FACTS", externalProvider: "OPEN_FOOD_FACTS", externalId: product.externalId,
    }) }));
    expect(prismaMock.foodNutrient.createMany).toHaveBeenCalled();
    expect(prismaMock.foodServing.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ label: "Becher (200 g)" }) }));
    expect(prismaMock.foodSource.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ url: product.provenance.url }) }));
  });

  it("lets a partial product add nutrients without erasing the ones it omits", async () => {
    prismaMock.food.findUnique.mockResolvedValueOnce({ id: "food-1" }).mockResolvedValueOnce(foodRow);
    const partial = {
      externalId: "4000000000001", name: "Müller Milchreis Original",
      basisAmount: 100, basisUnit: "G" as const, nutrients: { energyKcal: 130, calcium: null },
      partial: true,
      provenance: { provider: "OPEN_FOOD_FACTS", retrievedAt: new Date(), estimated: false },
    };

    await upsertProviderFood(partial, "de");

    // Only the keys this source actually carries are cleared and rewritten;
    // a vitamin an earlier barcode lookup stored has to survive.
    expect(prismaMock.foodNutrient.deleteMany).toHaveBeenCalledWith({
      where: { foodId: "food-1", nutrientKey: { in: ["energyKcal"] } },
    });
    // An unknown serving must not null out a known one either.
    expect(prismaMock.foodServing.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.food.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.not.objectContaining({ servingSize: null }) }),
    );
  });

  it("replaces the whole nutrient set for a complete product", async () => {
    prismaMock.food.findUnique.mockResolvedValueOnce({ id: "food-1" }).mockResolvedValueOnce(foodRow);
    const complete = {
      externalId: "4000000000001", name: "Müller Milchreis Original",
      basisAmount: 100, basisUnit: "G" as const, nutrients: { energyKcal: 130 },
      provenance: { provider: "OPEN_FOOD_FACTS", retrievedAt: new Date(), estimated: false },
    };

    await upsertProviderFood(complete, "de");

    expect(prismaMock.foodNutrient.deleteMany).toHaveBeenCalledWith({ where: { foodId: "food-1" } });
    expect(prismaMock.foodServing.deleteMany).toHaveBeenCalledWith({ where: { foodId: "food-1" } });
  });

  it("reuses the provider identity rather than creating a duplicate", async () => {
    prismaMock.food.findUnique
      .mockResolvedValueOnce({ id: "food-1" })
      .mockResolvedValueOnce(foodRow);
    const product = {
      externalId: "4000000000001", barcode: "4000000000001", name: "Müller Milchreis Original",
      basisAmount: 100, basisUnit: "G" as const, nutrients: { energyKcal: 120 },
      provenance: { provider: "OPEN_FOOD_FACTS", retrievedAt: new Date(), estimated: false },
    };
    await upsertProviderFood(product, "de");
    expect(prismaMock.food.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "food-1" } }));
    expect(prismaMock.food.create).not.toHaveBeenCalled();
  });
});

describe("local network decision", () => {
  const match = { barcodeMatch: false, exactNameMatch: false, exactNameBrandMatch: false, textMatch: 0.8, previouslyUsed: false };
  it("recognizes barcode, exact name, and name-plus-brand identities", () => {
    expect(hasIdentityMatch([{ ...match, barcodeMatch: true }])).toBe(true);
    expect(hasIdentityMatch([{ ...match, exactNameMatch: true }])).toBe(true);
    expect(hasIdentityMatch([{ ...match, exactNameBrandMatch: true }])).toBe(true);
  });
  it("keeps a strong previously consumed partial match local", () => {
    expect(hasStrongLocalMatch([{ ...match, previouslyUsed: true }])).toBe(true);
    expect(hasStrongLocalMatch([{ ...match, textMatch: 0.2, previouslyUsed: true }])).toBe(false);
  });
});
