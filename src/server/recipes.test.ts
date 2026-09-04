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
      // Saving as a draft takes the recipe's Food away again.
      deleteMany: vi.fn(),
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
      food: { findFirst: vi.fn() },
      diaryDay: { upsert: vi.fn(async () => ({ id: "day-1" })) },
      diaryEntry: { create: vi.fn() },
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
  prismaMock.diaryDay.upsert.mockResolvedValue({ id: "day-1" });
});

/** A second gram-based food, so a mixed-up choice is visible in the result. */
const butter = {
  id: "food-butter", name: "Butter", basisAmount: 100, basisUnit: "G", densityGPerMl: null,
  nutrients: [{ nutrientKey: "energyKcal", value: 740 }], servings: [], sources: [],
};

/**
 * A draft as the AI ingestion leaves one: the first component matched nothing,
 * so its row offers no radio group at all and submits no choice.
 */
const draftWithUnmatchedFirst = {
  id: "recipe-1", name: "Butterbrot", description: null, servings: 2, yieldWeightG: null, instructions: null, tags: [], sources: [],
  ingredients: [{ foodId: "food-flour", amount: 200, unit: "g", normalizedGrams: 200, normalizedMl: null, food: flour }],
  import: {
    logAfterConfirm: false, meal: null, diaryDate: null,
    draft: { components: [
      { name: "Brot", quantity: 2, unit: "Scheiben", candidates: [] },
      { name: "Butter", quantity: 20, unit: "g", candidates: [{ foodId: "food-butter", grams: 20 }] },
    ] },
  },
};

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

  it("drops an unmeasurable ingredient from a draft instead of failing it", async () => {
    // An AI import has nobody to report the bad line to yet, and failing the
    // save threw away a recipe that was otherwise extracted correctly. The
    // ingredient is reported back so the review screen can name it.
    tx.food.findMany.mockResolvedValue([flour, butter]);
    const result = await saveRecipe("user-1", {
      ...input,
      ingredients: [{ foodId: "food-flour", amount: 200, unit: "g" }, { foodId: "food-butter", amount: 2, unit: "EL" }],
    }, undefined, { status: "DRAFT" });

    expect(result.skipped).toEqual([{ foodId: "food-butter", name: "Butter", amount: 2, unit: "EL", reason: "unknown-unit" }]);
    expect(tx.recipeIngredient.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ foodId: "food-flour", position: 0 })],
    }));
  });

  it("still fails a draft that has no usable ingredient left", async () => {
    // A partial extraction is worth keeping; an empty one is a failed run, and
    // storing it as a recipe would leave the reader to work that out.
    await expect(saveRecipe("user-1", { ...input, ingredients: [{ foodId: "food-flour", amount: 2, unit: "EL" }] }, undefined, { status: "DRAFT" }))
      .rejects.toThrow(new PortionError("unknown-unit"));
  });

  it("weighs a volume food through the density assumed for it", async () => {
    // Every Open Food Facts liquid arrives without a density. Before one was
    // assumed, this ingredient could not be weighed at all.
    const stock = {
      id: "food-stock", name: "Gemüsebrühe", basisAmount: 100, basisUnit: "ML", densityGPerMl: null,
      nutrients: [{ nutrientKey: "energyKcal", value: 4 }], servings: [], sources: [],
    };
    tx.food.findMany.mockResolvedValue([stock]);

    const result = await saveRecipe("user-1", { ...input, ingredients: [{ foodId: "food-stock", amount: 500, unit: "ml" }] });

    expect(result.skipped).toEqual([]);
    expect(tx.recipeIngredient.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ foodId: "food-stock", normalizedGrams: 500, normalizedMl: 500 })],
    }));
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

describe("the choices a reader makes on a draft", () => {
  it("stays with the component it was made for when an earlier row offered none", async () => {
    // The radio groups are keyed by index and an unmatched component submits
    // nothing. Collecting the entries into a list instead of reading them by
    // key shifted every later choice up: the butter's food was confirmed as the
    // bread, and the last ingredient was dropped.
    prismaMock.recipe.findFirst.mockResolvedValue(draftWithUnmatchedFirst);
    prismaMock.food.findFirst.mockResolvedValue(butter);
    tx.food.findMany.mockResolvedValue([butter]);

    await confirmRecipe("user-1", "recipe-1", new Map([[1, "food-butter"]]));

    expect(prismaMock.food.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.recipeIngredient.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ foodId: "food-butter", amount: 20, unit: "g" })],
    });
  });

  it("leaves out a component the reader declined", async () => {
    prismaMock.recipe.findFirst.mockResolvedValue(draftWithUnmatchedFirst);
    prismaMock.food.findFirst.mockResolvedValue(butter);

    // An empty value is the "leave it out" option, not a missing answer.
    await expect(confirmRecipe("user-1", "recipe-1", new Map([[1, ""]]))).rejects.toThrow(new PortionError("invalid-amount"));
  });

  /**
   * The reported bug, at the end that turns a draft into a recipe. The reader
   * picked a food for "1 EL Mehl" and pressed confirm; the flour defines no
   * spoon, so the component was dropped without a word and the recipe came back
   * without the ingredient they had just chosen.
   */
  it("keeps a component measured in a household unit at the weight the model read", async () => {
    prismaMock.recipe.findFirst.mockResolvedValue({
      ...draftWithUnmatchedFirst,
      import: {
        ...draftWithUnmatchedFirst.import,
        draft: { components: [{ name: "Mehl", quantity: 1, unit: "EL", estimatedGrams: 10, candidates: [{ foodId: "food-flour", grams: null }] }] },
      },
    });
    prismaMock.food.findFirst.mockResolvedValue(flour);

    await confirmRecipe("user-1", "recipe-1", new Map([[0, "food-flour"]]));

    expect(tx.recipeIngredient.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ foodId: "food-flour", amount: 10, unit: "g" })],
    });
  });

  it("leaves out a component nothing can weigh rather than logging it as nothing", async () => {
    prismaMock.recipe.findFirst.mockResolvedValue({
      ...draftWithUnmatchedFirst,
      import: {
        ...draftWithUnmatchedFirst.import,
        draft: { components: [{ name: "Gewürze", quantity: 1, unit: "Prise", candidates: [{ foodId: "food-flour", grams: null }] }] },
      },
    });
    prismaMock.food.findFirst.mockResolvedValue(flour);

    await expect(confirmRecipe("user-1", "recipe-1", new Map([[0, "food-flour"]]))).rejects.toThrow(new PortionError("invalid-amount"));
  });

  it("keeps what the resolver matched when the reader chose nothing at all", async () => {
    prismaMock.recipe.findFirst.mockResolvedValue(draftWithUnmatchedFirst);

    await confirmRecipe("user-1", "recipe-1");

    expect(prismaMock.food.findFirst).not.toHaveBeenCalled();
    expect(tx.recipeIngredient.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ foodId: "food-flour", amount: 200 })],
    });
  });
});

describe("a recipe the submitter also asked to log", () => {
  const loggable = (logAfterConfirm: boolean) => ({
    ...draftWithUnmatchedFirst,
    import: { ...draftWithUnmatchedFirst.import, logAfterConfirm, meal: "DINNER", diaryDate: new Date("2026-09-03T00:00:00.000Z") },
  });

  it("writes exactly one portion of it, once it is confirmed and not before", async () => {
    prismaMock.recipe.findFirst.mockResolvedValue(loggable(true));

    await confirmRecipe("user-1", "recipe-1");

    expect(prismaMock.diaryEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ recipeId: "recipe-1", meal: "DINNER", quantity: 1, unit: "serving" }),
    }));
  });

  it("writes nothing when only a recipe was asked for", async () => {
    prismaMock.recipe.findFirst.mockResolvedValue(loggable(false));

    await confirmRecipe("user-1", "recipe-1");

    expect(prismaMock.diaryEntry.create).not.toHaveBeenCalled();
  });
});
