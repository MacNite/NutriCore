import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, ingestionInput, food, recipe, recipeSource, user, resolveComponent } = vi.hoisted(() => {
  const ingestionInput = { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() };
  const food = { findUnique: vi.fn() };
  const recipe = { findFirst: vi.fn() };
  const recipeSource = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
  const user = { findUnique: vi.fn() };
  return {
    ingestionInput, food, recipe, recipeSource, user,
    resolveComponent: vi.fn(),
    prismaMock: { aiIngestionInput: ingestionInput, food, recipe, recipeSource, user },
  };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/env", () => ({ researchEnabled: () => false }));
vi.mock("@/providers/ollama", () => ({ OllamaProvider: class {} }));
vi.mock("./component-resolver", () => ({ resolveComponent }));
vi.mock("./meal-url", () => ({ fetchMealPage: vi.fn(async () => ({ url: "https://example.test/r", title: "Pfannkuchen", excerpt: "Zutaten:\n- 200 g Mehl", recipeFound: true, structuredRecipe: { name: "Pfannkuchen", description: "Dünne Pfannkuchen von der Seite.", ingredientLines: ["200 g Mehl"], instructions: "1. Mehl abwiegen.\n2. Backen." } })) }));
vi.mock("./recipes", () => ({ saveRecipe: vi.fn(async () => ({ recipe: { id: "recipe-1", name: "Pfannkuchen" }, food: null, skipped: [] })) }));

import { runRecipeImport } from "./ai-ingestion";
import { saveRecipe } from "./recipes";
import { fetchMealPage } from "./meal-url";

/** A gram-based food with no named portions: "200 g" converts, "Scheiben" cannot. */
const flour = { id: "food-flour", name: "Mehl", basisAmount: 100, basisUnit: "G", densityGPerMl: null, servings: [] };

const extraction = {
  name: "Pfannkuchen",
  description: "Dünne Pfannkuchen aus der Pfanne.",
  servings: 4,
  instructions: "1. Mehl abwiegen.\n2. Backen.",
  components: [{ name: "Mehl", quantity: 200, unit: "g" }],
  confidence: "high" as const,
  warnings: [],
};

const ai = { complete: vi.fn() };

const input = (overrides: Record<string, unknown> = {}) => ({
  id: "input-1", userId: "user-1", intent: "RECIPE", text: "Pfannkuchen", sourceUrl: null,
  servings: 4, imageData: null, imageMime: null, ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  ai.complete.mockResolvedValue(extraction);
  ingestionInput.findUnique.mockResolvedValue(input());
  user.findUnique.mockResolvedValue({ profile: { language: "de", researchEnabled: false } });
  food.findUnique.mockResolvedValue(flour);
  recipe.findFirst.mockResolvedValue(null);
  recipeSource.findFirst.mockResolvedValue(null);
  resolveComponent.mockResolvedValue({ selectedFoodId: "food-flour", candidates: [{ foodId: "food-flour", grams: 200 }], grams: 200, gramsSource: "UNIT" });
});

const run = () => runRecipeImport("input-1", { ai } as never);

describe("extracting a recipe", () => {
  it("keeps the whole recipe, not the one portion a quick meal logs", async () => {
    // The yield the submitter entered is the recipe's own, and the amounts
    // belong to all of it. Scaling here is what made the quick meal's recipe a
    // single portion of something the user never cooked one portion of.
    const draft = await run();

    expect(draft.servings).toBe(4);
    expect(vi.mocked(saveRecipe).mock.calls[0][1]).toMatchObject({
      name: "Pfannkuchen",
      description: "Dünne Pfannkuchen aus der Pfanne.",
      instructions: "1. Mehl abwiegen.\n2. Backen.",
      servings: 4,
    });
  });

  it("never lets the model supply nutrition for a recipe", async () => {
    // A recipe's numbers always trace to a source. The quick meal may fall back
    // to the model's own per-100g figures; a recipe may not.
    await run();

    expect(resolveComponent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ allowModelEstimates: false }));
  });

  it("asks the page for its preparation steps, which a meal run does not need", async () => {
    ingestionInput.findUnique.mockResolvedValue(input({ sourceUrl: "https://example.test/r" }));

    await run();

    expect(vi.mocked(fetchMealPage)).toHaveBeenCalledWith("https://example.test/r", undefined, { includeInstructions: true });
  });

  it("keeps the source it was read from, so the recipe can be checked against it", async () => {
    ingestionInput.findUnique.mockResolvedValue(input({ sourceUrl: "https://example.test/r" }));

    await run();

    expect(recipeSource.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ recipeId: "recipe-1", url: "https://example.test/r" }),
    }));
  });

  /**
   * The user's own language is the one they read the recipe in. Nothing used to
   * say so, and a German user importing a recipe got an English name,
   * description and Zubereitung.
   */
  it("asks for the prose in the language the user reads", async () => {
    await run();

    expect(ai.complete.mock.calls[0][0].prompt).toContain("in German");
  });

  it("asks for English when that is what the user chose", async () => {
    user.findUnique.mockResolvedValue({ profile: { language: "en", researchEnabled: false } });

    await run();

    expect(ai.complete.mock.calls[0][0].prompt).toContain("in English");
  });

  it("stores no source for text or a photo, which have none", async () => {
    await run();

    expect(recipeSource.create).not.toHaveBeenCalled();
  });
});

describe("turning components into ingredients", () => {
  it("keeps the source's own amount and unit where the food can be measured in it", async () => {
    // "200 g Mehl", not "200 g" of a gram figure the resolver happened to reach.
    const draft = await run();

    expect(draft.ingredients).toEqual([expect.objectContaining({ foodId: "food-flour", amount: 200, unit: "g" })]);
  });

  it("falls back to the resolved weight for a portion word the food does not name", async () => {
    // "2 Scheiben" of a flour that defines no slice: the weight is the only
    // thing here that is a fact, so the ingredient is stored in grams.
    ai.complete.mockResolvedValue({ ...extraction, components: [{ name: "Brot", quantity: 2, unit: "Scheiben" }] });
    resolveComponent.mockResolvedValue({ selectedFoodId: "food-flour", candidates: [{ foodId: "food-flour", grams: 60 }], grams: 60, gramsSource: "MODEL" });

    const draft = await run();

    expect(draft.ingredients).toEqual([expect.objectContaining({ amount: 60, unit: "g" })]);
  });

  /**
   * The reported bug, at the end that writes the draft. Every household measure
   * in the source - "2 M" eggs, "1 EL" flour, "0.5 TL" baking powder, "1
   * Handvoll" tomatoes - matched a real food and was then dropped for having no
   * convertible unit, so a nine-ingredient recipe arrived as a two-ingredient
   * draft and confirming it added nothing.
   */
  it("keeps an ingredient measured in a household unit, weighed by the model", async () => {
    ai.complete.mockResolvedValue({ ...extraction, components: [{ name: "Mehl", quantity: 1, unit: "EL", estimatedGrams: 10 }] });
    resolveComponent.mockResolvedValue({ selectedFoodId: "food-flour", candidates: [{ foodId: "food-flour", grams: null, gramsSource: "NONE" }], grams: null, gramsSource: "NONE" });

    const draft = await run();

    expect(draft.ingredients).toEqual([expect.objectContaining({ foodId: "food-flour", amount: 10, unit: "g" })]);
    expect(draft.unconverted).toEqual([]);
    // Usable, but nobody's stated fact: the review has to say so.
    expect(draft.estimatedWeights).toEqual(["Mehl (1 EL) ≈ 10 g"]);
  });

  it("still reports an ingredient nothing can weigh, rather than guessing at one", async () => {
    // No spoon on the food and no reading from the model either. There is
    // nothing here to convert, so the ingredient is named for the reader.
    ai.complete.mockResolvedValue({ ...extraction, components: [{ name: "Gewürze", quantity: 1, unit: "Prise" }] });
    resolveComponent.mockResolvedValue({ selectedFoodId: "food-flour", candidates: [{ foodId: "food-flour", grams: null, gramsSource: "NONE" }], grams: null, gramsSource: "NONE" });

    const draft = await run();

    expect(draft.ingredients).toEqual([]);
    expect(draft.unconverted).toEqual(["Gewürze (1 Prise)"]);
    expect(draft.estimatedWeights).toEqual([]);
  });

  it("calls a weight the source itself stated exactly that", async () => {
    const draft = await run();

    expect(draft.estimatedWeights).toEqual([]);
  });

  it("reports an ingredient nothing matched instead of inventing one", async () => {
    resolveComponent.mockResolvedValue({ selectedFoodId: null, candidates: [], grams: null, gramsSource: "NONE" });

    const draft = await run();

    expect(draft.ingredients).toEqual([]);
    expect(draft.unmatched).toEqual(["Mehl"]);
  });

  it("offers the candidates it found, so the draft review has something to choose from", async () => {
    const draft = await run();

    expect(draft.components?.[0].candidates).toEqual([{ foodId: "food-flour", grams: 200 }]);
  });
});

describe("the recipe's own prose", () => {
  /**
   * The reported failure: "Zubereitung" was empty. The page's steps were read,
   * sanitised and put in front of the model - and then the run kept only what
   * the model echoed back, which a small local model routinely does not.
   */
  it("falls back to the page's own steps when the model returned none", async () => {
    ingestionInput.findUnique.mockResolvedValue(input({ sourceUrl: "https://example.test/r" }));
    ai.complete.mockResolvedValue({ ...extraction, description: "", instructions: "" });

    const draft = await run();

    expect(draft.instructions).toBe("1. Mehl abwiegen.\n2. Backen.");
    expect(draft.description).toBe("Dünne Pfannkuchen von der Seite.");
    expect(vi.mocked(saveRecipe).mock.calls[0][1]).toMatchObject({ instructions: "1. Mehl abwiegen.\n2. Backen." });
  });

  it("keeps the model's own wording where it gave any, because that one is translated", async () => {
    ingestionInput.findUnique.mockResolvedValue(input({ sourceUrl: "https://example.test/r" }));

    const draft = await run();

    expect(draft.instructions).toBe("1. Mehl abwiegen.\n2. Backen.");
    expect(draft.description).toBe("Dünne Pfannkuchen aus der Pfanne.");
  });

  it("leaves them empty for a text or photo import that has no page to fall back on", async () => {
    ai.complete.mockResolvedValue({ ...extraction, description: "", instructions: "" });

    const draft = await run();

    expect(draft.instructions).toBe("");
    expect(draft.description).toBe("");
  });
});

describe("storing the draft", () => {
  it("leaves a recipe the user already confirmed exactly as they confirmed it", async () => {
    recipe.findFirst.mockResolvedValue({ id: "recipe-1", status: "ACTIVE" });

    await run();

    expect(vi.mocked(saveRecipe)).not.toHaveBeenCalled();
  });

  it("refuses an input that is not a recipe run", async () => {
    ingestionInput.findUnique.mockResolvedValue(input({ intent: "MEAL" }));

    await expect(run()).rejects.toThrow();
  });
});

describe("an ingredient whose food is sold by volume", () => {
  /** Every Open Food Facts liquid: a millilitre basis and no density at all. */
  const stock = { id: "food-stock", name: "Gemüsebrühe", basisAmount: 100, basisUnit: "ML", densityGPerMl: null, servings: [] };

  beforeEach(() => {
    ai.complete.mockResolvedValue({ ...extraction, components: [{ name: "Gemüsebrühe", quantity: 500, unit: "ml" }] });
    food.findUnique.mockResolvedValue(stock);
    resolveComponent.mockResolvedValue({ selectedFoodId: "food-stock", candidates: [{ foodId: "food-stock", grams: 500 }], grams: 500, gramsSource: "UNIT" });
  });

  it("keeps it, and says the weight rests on an assumed density", async () => {
    // This is the case that used to fail the entire import with "Cannot resolve
    // portion: density-required" - not the one ingredient, the whole job.
    const draft = await run();

    expect(draft.ingredients).toEqual([expect.objectContaining({ foodId: "food-stock", amount: 500, unit: "ml" })]);
    expect(draft.unconverted).toEqual([]);
    expect(draft.assumedDensity).toEqual(["Gemüsebrühe (500 ml)"]);
  });

  it("reports it instead of failing when the save cannot weigh it either", async () => {
    // The save re-reads the food in its own transaction and can still reject an
    // ingredient this side accepted. A partial recipe beats no recipe.
    vi.mocked(saveRecipe).mockResolvedValueOnce({
      recipe: { id: "recipe-1", name: "Suppe" }, food: null,
      skipped: [{ foodId: "food-stock", name: "Gemüsebrühe", amount: 500, unit: "ml", reason: "density-required" }],
    } as never);

    const draft = await run();

    expect(draft.ingredients).toEqual([]);
    expect(draft.unconverted).toEqual(["Gemüsebrühe (500 ml)"]);
    // It is not in the recipe, so nothing may still describe how it was weighed.
    expect(draft.assumedDensity).toEqual([]);
  });

  it("reports a household measure it cannot weigh at all", async () => {
    // No stated quantity to convert and no model weight either: there is no
    // number to put in the recipe, so it is named rather than invented.
    ai.complete.mockResolvedValue({ ...extraction, components: [{ name: "Gemüsebrühe", quantity: 1, unit: "Schuss" }] });
    resolveComponent.mockResolvedValue({ selectedFoodId: "food-stock", candidates: [{ foodId: "food-stock", grams: null }], grams: null, gramsSource: "NONE" });

    const draft = await run();

    expect(draft.ingredients).toEqual([]);
    expect(draft.unconverted).toEqual(["Gemüsebrühe (1 Schuss)"]);
  });
});
