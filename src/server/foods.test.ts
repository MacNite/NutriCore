import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, searchQueryCache } = vi.hoisted(() => {
  const searchQueryCache = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  };
  return { searchQueryCache, prismaMock: {
    searchQueryCache,
    food: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
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
import { fetchRemote, hasIdentityMatch, hasStrongLocalMatch, upsertProviderFood } from "./foods";

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
