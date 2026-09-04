import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, tx } = vi.hoisted(() => {
  const tx = {
    recipePublication: {
      findFirst: vi.fn(async () => null as { id: string } | null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "pub-1", ...data })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "pub-1", ...data })),
    },
    recipePublicationIngredient: { deleteMany: vi.fn(), createMany: vi.fn() },
    food: {
      findFirst: vi.fn(async (_args: { where: Record<string, unknown> }) => null as Record<string, unknown> | null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "copied-food", ...data })),
    },
  };
  return {
    tx,
    prismaMock: {
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
      recipe: { findFirst: vi.fn() },
      recipePublication: { findFirst: vi.fn(), update: vi.fn() },
      userProfile: { findUnique: vi.fn(async () => ({ displayName: "Alice", language: "de" })) },
      user: { findUniqueOrThrow: vi.fn(async () => ({ username: "alice" })) },
      food: { deleteMany: vi.fn() },
    },
  };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const saveRecipeMock = vi.hoisted(() =>
  vi.fn(
    async (
      _userId: string,
      _input: { ingredients: { foodId: string; amount: number; unit: string }[] },
      _recipeId?: string,
      _options?: Record<string, unknown>,
    ) => ({ recipe: { id: "copy-1" } }),
  ),
);
vi.mock("./recipes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./recipes")>()),
  saveRecipe: saveRecipeMock,
}));

import { publishRecipe, PublicationError, savePublicationAsRecipe } from "./recipe-publications";

/** The food shape `getRecipe` hands the publisher, as far as this file uses it. */
interface FoodFixture {
  id: string; name: string; brand: string | null; basisAmount: number; basisUnit: string;
  densityGPerMl: number | null; sourceType: string; externalProvider: string | null;
  externalId: string | null; barcode: string | null; cacheExpiresAt: Date | null;
  nutrients: { nutrientKey: string; value: number }[]; servings: never[]; sources: never[];
}

/** A gram-based food the author created themselves: private, no provider id. */
const privateFood: FoodFixture = {
  id: "food-private", name: "Omas Sauce", brand: null, basisAmount: 100, basisUnit: "G",
  densityGPerMl: null, sourceType: "USER", externalProvider: null, externalId: null,
  barcode: null, cacheExpiresAt: null,
  nutrients: [{ nutrientKey: "energyKcal", value: 120 }], servings: [], sources: [],
};

/** A shared Open Food Facts row: ownerless, addressable by its provider id. */
const providerFood: FoodFixture = {
  id: "food-off", name: "Passata", brand: "Mutti", basisAmount: 100, basisUnit: "G",
  densityGPerMl: null, sourceType: "OPEN_FOOD_FACTS", externalProvider: "openfoodfacts",
  externalId: "80012345", barcode: "80012345", cacheExpiresAt: null,
  nutrients: [{ nutrientKey: "energyKcal", value: 32 }], servings: [], sources: [],
};

/** A FatSecret row: cached under a licence that forbids permanent storage. */
const cachedFood: FoodFixture = {
  ...providerFood, id: "food-fs", name: "Fertigsauce", sourceType: "FATSECRET",
  externalProvider: "fatsecret", externalId: "fs-99", barcode: null,
  cacheExpiresAt: new Date("2026-09-05T00:00:00Z"),
};

const recipeWith = (foods: FoodFixture[], status = "ACTIVE") => ({
  id: "recipe-1", ownerId: "alice", name: "Sugo", description: "Notiz an mich", servings: 4,
  yieldWeightG: null, instructions: "Kochen.", tags: ["pasta"], status, sources: [],
  ingredients: foods.map((food, position) => ({
    id: `ing-${position}`, foodId: food.id, amount: 200, unit: "g",
    normalizedGrams: 200, normalizedMl: null, position, food,
  })),
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.userProfile.findUnique.mockResolvedValue({ displayName: "Alice", language: "de" });
  prismaMock.user.findUniqueOrThrow.mockResolvedValue({ username: "alice" });
  tx.recipePublication.findFirst.mockResolvedValue(null);
  tx.food.findFirst.mockResolvedValue(null);
  saveRecipeMock.mockResolvedValue({ recipe: { id: "copy-1" } });
});

const publishedIngredients = () =>
  (tx.recipePublicationIngredient.createMany.mock.calls[0][0] as { data: Record<string, unknown>[] }).data;

describe("publishing a recipe", () => {
  it("never puts the author's food ids into the publication", async () => {
    prismaMock.recipe.findFirst.mockResolvedValue(recipeWith([privateFood, providerFood]));

    await publishRecipe("alice", "recipe-1", { title: "Sugo", description: "", instructions: "", tags: [] });

    const rows = publishedIngredients();
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(Object.keys(row)).not.toContain("foodId");
    expect(JSON.stringify(rows)).not.toContain("food-private");
  });

  it("copies the nutrition into the snapshot so a reader needs no author row", async () => {
    prismaMock.recipe.findFirst.mockResolvedValue(recipeWith([privateFood]));

    await publishRecipe("alice", "recipe-1", { title: "Sugo", description: "", instructions: "", tags: [] });

    const [row] = publishedIngredients();
    expect(row.displayName).toBe("Omas Sauce");
    expect(row.nutritionSnapshot).toMatchObject({ energyKcal: 120 });
    expect(row.weightG).toBe(200);
  });

  it("marks an ingredient from a cache-only source as not permanently storable", async () => {
    prismaMock.recipe.findFirst.mockResolvedValue(recipeWith([providerFood, cachedFood]));

    await publishRecipe("alice", "recipe-1", { title: "Sugo", description: "", instructions: "", tags: [] });

    const rows = publishedIngredients();
    expect(rows[0]).toMatchObject({ sourceType: "OPEN_FOOD_FACTS", permanent: true });
    expect(rows[1]).toMatchObject({ sourceType: "FATSECRET", permanent: false });
  });

  it("publishes the title the author reviewed, not the private recipe's own", async () => {
    prismaMock.recipe.findFirst.mockResolvedValue(recipeWith([privateFood]));

    await publishRecipe("alice", "recipe-1", { title: "Tomatensugo", description: "Für vier", instructions: "Kochen.", tags: ["pasta"] });

    expect(tx.recipePublication.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: "Tomatensugo", description: "Für vier", authorNameSnapshot: "Alice" }) }),
    );
  });

  it("refuses to publish an unconfirmed AI draft", async () => {
    prismaMock.recipe.findFirst.mockResolvedValue(recipeWith([privateFood], "DRAFT"));

    await expect(publishRecipe("alice", "recipe-1", { title: "Sugo", description: "", instructions: "", tags: [] }))
      .rejects.toThrow(PublicationError);
    expect(tx.recipePublication.create).not.toHaveBeenCalled();
  });

  it("replaces the existing publication instead of adding a second one", async () => {
    prismaMock.recipe.findFirst.mockResolvedValue(recipeWith([privateFood]));
    tx.recipePublication.findFirst.mockResolvedValue({ id: "pub-1" });

    await publishRecipe("alice", "recipe-1", { title: "Sugo", description: "", instructions: "", tags: [] });

    expect(tx.recipePublication.update).toHaveBeenCalled();
    expect(tx.recipePublication.create).not.toHaveBeenCalled();
  });
});

/** One published ingredient, as `publishRecipe` would have written it. */
const publishedIngredient = (overrides: Record<string, unknown> = {}) => ({
  publicationId: "pub-1", position: 0, displayName: "Passata", brand: "Mutti",
  amount: 200, unit: "g", weightG: 200, normalizedMl: null,
  basisAmount: 100, basisUnit: "G", nutritionSnapshot: { energyKcal: 32 },
  sourceType: "OPEN_FOOD_FACTS", externalProvider: "openfoodfacts", externalId: "80012345",
  barcode: "80012345", densityGPerMl: null, permanent: true, ...overrides,
});

const publication = (ingredients: Record<string, unknown>[]) => ({
  id: "pub-1", authorId: "alice", authorNameSnapshot: "Alice", title: "Sugo", description: null,
  servings: 4, yieldWeightG: null, instructions: null, tags: [], status: "PUBLISHED", ingredients,
});

const savedIngredients = () => saveRecipeMock.mock.calls[0][1].ingredients;

describe("saving a shared recipe", () => {
  it("re-uses the shared provider row the recipient can already read", async () => {
    prismaMock.recipePublication.findFirst.mockResolvedValue(publication([publishedIngredient()]));
    tx.food.findFirst.mockResolvedValue({ id: "food-off", ownerId: null, basisUnit: "G", densityGPerMl: null, sourceType: "OPEN_FOOD_FACTS" });

    const result = await savePublicationAsRecipe("bob", "pub-1");

    expect(tx.food.create).not.toHaveBeenCalled();
    expect(savedIngredients()).toEqual([{ foodId: "food-off", amount: 200, unit: "g" }]);
    expect(result.unsaved).toEqual([]);
  });

  it("only ever looks for foods the recipient may read", async () => {
    prismaMock.recipePublication.findFirst.mockResolvedValue(publication([publishedIngredient()]));
    tx.food.findFirst.mockResolvedValue({ id: "food-off", ownerId: null, basisUnit: "G", densityGPerMl: null, sourceType: "OPEN_FOOD_FACTS" });

    await savePublicationAsRecipe("bob", "pub-1");

    // The author's private rows are behind exactly this clause; a lookup
    // without it would hand one to whoever saved the recipe.
    expect(tx.food.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: [{ ownerId: null }, { ownerId: "bob" }] }) }),
    );
  });

  it("gives the recipient their own copy of a food nobody else has", async () => {
    prismaMock.recipePublication.findFirst.mockResolvedValue(publication([
      publishedIngredient({ displayName: "Omas Sauce", sourceType: "USER", externalProvider: null, externalId: null, barcode: null, nutritionSnapshot: { energyKcal: 120 } }),
    ]));

    await savePublicationAsRecipe("bob", "pub-1");

    expect(tx.food.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: "bob", name: "Omas Sauce", sourceType: "IMPORTED" }),
      }),
    );
    expect(savedIngredients()).toEqual([{ foodId: "copied-food", amount: 200, unit: "g" }]);
  });

  it("does not recreate a cache-only food whose shared row has been pruned", async () => {
    prismaMock.recipePublication.findFirst.mockResolvedValue(publication([
      publishedIngredient(),
      publishedIngredient({ position: 1, displayName: "Fertigsauce", sourceType: "FATSECRET", externalProvider: "fatsecret", externalId: "fs-99", barcode: null, permanent: false }),
    ]));
    tx.food.findFirst.mockImplementation(async ({ where }) =>
      where.externalProvider === "openfoodfacts" ? { id: "food-off", ownerId: null, basisUnit: "G", densityGPerMl: null, sourceType: "OPEN_FOOD_FACTS" } : null,
    );

    const result = await savePublicationAsRecipe("bob", "pub-1");

    expect(tx.food.create).not.toHaveBeenCalled();
    expect(savedIngredients()).toEqual([{ foodId: "food-off", amount: 200, unit: "g" }]);
    expect(result.unsaved).toEqual([{ displayName: "Fertigsauce", reason: "expired-source" }]);
  });

  it("saves a millilitre food in millilitres, as the publication measured it", async () => {
    prismaMock.recipePublication.findFirst.mockResolvedValue(publication([
      publishedIngredient({ displayName: "Milch", basisUnit: "ML", weightG: 206, normalizedMl: 200 }),
    ]));
    tx.food.findFirst.mockResolvedValue({ id: "food-milk", ownerId: null, basisUnit: "ML", densityGPerMl: null, sourceType: "OPEN_FOOD_FACTS" });

    await savePublicationAsRecipe("bob", "pub-1");

    expect(savedIngredients()).toEqual([{ foodId: "food-milk", amount: 200, unit: "ml" }]);
  });

  it("records who wrote the recipe it was copied from", async () => {
    prismaMock.recipePublication.findFirst.mockResolvedValue(publication([publishedIngredient()]));
    tx.food.findFirst.mockResolvedValue({ id: "food-off", ownerId: null, basisUnit: "G", densityGPerMl: null, sourceType: "OPEN_FOOD_FACTS" });

    await savePublicationAsRecipe("bob", "pub-1");

    expect(saveRecipeMock.mock.calls[0][3]).toMatchObject({
      sourceType: "IMPORTED",
      forkedFrom: { publicationId: "pub-1", authorName: "Alice" },
    });
  });

  it("cleans up only the foods it created when the recipe cannot be saved", async () => {
    prismaMock.recipePublication.findFirst.mockResolvedValue(publication([
      publishedIngredient({ sourceType: "USER", externalProvider: null, externalId: null, barcode: null }),
    ]));
    saveRecipeMock.mockRejectedValue(new Error("boom"));

    await expect(savePublicationAsRecipe("bob", "pub-1")).rejects.toThrow("boom");

    expect(prismaMock.food.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["copied-food"] }, ownerId: "bob" } });
  });

  it("keeps a food the recipient already had when the save fails", async () => {
    prismaMock.recipePublication.findFirst.mockResolvedValue(publication([publishedIngredient()]));
    // Matched by provider id, and owned by the recipient from an earlier import.
    tx.food.findFirst.mockResolvedValue({ id: "food-theirs", ownerId: "bob", basisUnit: "G", densityGPerMl: null, sourceType: "IMPORTED" });
    saveRecipeMock.mockRejectedValue(new Error("boom"));

    await expect(savePublicationAsRecipe("bob", "pub-1")).rejects.toThrow("boom");

    expect(prismaMock.food.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [] }, ownerId: "bob" } });
  });
});
