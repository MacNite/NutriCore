import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, tx } = vi.hoisted(() => {
  const tx = {
    recipe: {
      findFirst: vi.fn(async () => ({ id: "recipe-1" })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "recipe-1", ...data })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "recipe-1", ...data })),
    },
    food: {
      findMany: vi.fn(),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "recipe-food" })),
      update: vi.fn(async () => ({ id: "recipe-food" })),
    },
    recipeIngredient: { deleteMany: vi.fn(), createMany: vi.fn() },
    foodNutrient: { deleteMany: vi.fn(), createMany: vi.fn() },
    foodServing: { deleteMany: vi.fn(), create: vi.fn() },
    foodSource: { deleteMany: vi.fn(), create: vi.fn() },
  };
  return {
    tx,
    prismaMock: {
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
      recipe: { findFirst: vi.fn() },
    },
  };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { confirmRecipe, saveRecipe } from "./recipes";
import { PortionError } from "./diary";

/** A stored food measured in grams, with no density and no named portions. */
const flour = {
  id: "food-flour", name: "Mehl", basisAmount: 100, basisUnit: "G", densityGPerMl: null,
  nutrients: [{ nutrientKey: "energyKcal", value: 340 }], servings: [], sources: [],
};

const input = { name: "Auflauf", description: "", servings: 4, instructions: "", tags: [], ingredients: [{ foodId: "food-flour", amount: 200, unit: "g" }] };

beforeEach(() => {
  vi.clearAllMocks();
  tx.food.findMany.mockResolvedValue([flour]);
  tx.food.findFirst.mockResolvedValue(null);
});

describe("saving a recipe", () => {
  it("gives a confirmed recipe the Food entry that makes it loggable", async () => {
    const result = await saveRecipe("user-1", input);

    expect(tx.recipe.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ACTIVE" }) }));
    expect(tx.food.create).toHaveBeenCalled();
    expect(result.food).not.toBeNull();
  });

  it("stores a draft without one, so nothing unreviewed can be logged", async () => {
    const result = await saveRecipe("user-1", input, undefined, { status: "DRAFT", sourceType: "AI_RESEARCH", importId: "import-1" });

    expect(tx.recipe.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DRAFT", sourceType: "AI_RESEARCH", importId: "import-1" }),
    }));
    // No Food, and therefore nothing to log: that is what "draft" means here.
    expect(tx.food.create).not.toHaveBeenCalled();
    expect(tx.foodNutrient.createMany).not.toHaveBeenCalled();
    expect(result.food).toBeNull();
  });

  it("reports a unit this food cannot be measured in", async () => {
    // The failure the recipe form's unit dropdown now prevents entirely.
    await expect(saveRecipe("user-1", { ...input, ingredients: [{ foodId: "food-flour", amount: 2, unit: "EL" }] }))
      .rejects.toThrow(new PortionError("unknown-unit"));
  });
});

describe("confirming a draft", () => {
  it("recalculates it as an ordinary recipe and creates its Food", async () => {
    prismaMock.recipe.findFirst.mockResolvedValue({
      id: "recipe-1", name: "Auflauf", description: null, servings: 4, yieldWeightG: null, instructions: null, tags: [],
      ingredients: [{ foodId: "food-flour", amount: 200, unit: "g" }],
    });

    await confirmRecipe("user-1", "recipe-1");

    expect(tx.recipe.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "recipe-1" }, data: expect.objectContaining({ status: "ACTIVE" }) }));
    expect(tx.food.create).toHaveBeenCalled();
  });

  it("refuses a draft with nothing in it rather than storing an empty food", async () => {
    prismaMock.recipe.findFirst.mockResolvedValue({
      id: "recipe-1", name: "Auflauf", description: null, servings: 4, yieldWeightG: null, instructions: null, tags: [], ingredients: [],
    });

    await expect(confirmRecipe("user-1", "recipe-1")).rejects.toThrow(new PortionError("invalid-amount"));
  });
});
