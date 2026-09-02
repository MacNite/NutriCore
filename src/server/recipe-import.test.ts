import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

const { prismaMock, recipeImport, food, recipe, recipeSource } = vi.hoisted(() => {
  const recipeImport = { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() };
  const food = { findFirst: vi.fn() };
  const recipe = { findFirst: vi.fn() };
  const recipeSource = { create: vi.fn() };
  return { recipeImport, food, recipe, recipeSource, prismaMock: { recipeImport, food, recipe, recipeSource } };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("./meal-url", () => ({ fetchMealPage: vi.fn() }));
vi.mock("./recipes", () => ({ saveRecipe: vi.fn(async () => ({ recipe: { id: "recipe-1" }, food: null })) }));

import { runRecipeImport } from "./recipe-import";
import { fetchMealPage } from "./meal-url";
import { saveRecipe } from "./recipes";
import type { OllamaProvider } from "@/providers/ollama";

/**
 * Stands in for the adapter, applying the repair hook and the schema exactly as
 * `OllamaProvider.complete` does, so a test drives the same acceptance rules a
 * real answer meets.
 */
function modelAnswering(answer: unknown) {
  return {
    complete: vi.fn(async ({ schema, repair, prompt }: { schema: z.ZodType<unknown>; repair?: (value: unknown) => unknown; prompt: string }) => {
      void prompt;
      return schema.parse(repair ? repair(answer) : answer);
    }),
  };
}

const asProvider = (fake: { complete: unknown }) => fake as unknown as OllamaProvider;

/** A stored food with no density and no named portions: grams and kilograms only. */
const weighed = (name: string) => ({ id: `food-${name}`, name, basisUnit: "G", densityGPerMl: null, servings: [] });

beforeEach(() => {
  vi.clearAllMocks();
  food.findFirst.mockResolvedValue(null);
  recipe.findFirst.mockResolvedValue(null);
  recipeImport.update.mockResolvedValue({});
  recipeImport.findUnique.mockResolvedValue({
    id: "import-1",
    userId: "user-1",
    text: null,
    sourceUrl: "https://example.org/auflauf",
    servings: 4,
    imageData: null,
  });
  vi.mocked(fetchMealPage).mockResolvedValue({
    url: "https://example.org/auflauf",
    title: "Auflauf",
    excerpt: "Recipe: Auflauf\nIngredients:\n- 200 g Mehl\nInstructions:\n1. Mischen.",
    recipeFound: true,
  });
});

describe("recipe import from a URL", () => {
  it("reads the page through the same extractor Quick meal uses", async () => {
    food.findFirst.mockResolvedValue(weighed("Mehl"));
    const ai = modelAnswering({ name: "Auflauf", ingredients: [{ name: "Mehl", amount: 200, unit: "g" }] });

    const draft = await runRecipeImport("import-1", { ai: asProvider(ai) });

    // The recipe's own JSON-LD, plus the steps only a recipe draft needs.
    expect(fetchMealPage).toHaveBeenCalledWith("https://example.org/auflauf", undefined, { includeInstructions: true });
    expect(ai.complete.mock.calls[0][0].prompt).toContain("- 200 g Mehl");
    expect(draft).toMatchObject({ name: "Auflauf", servings: 4, unmatched: [], unconverted: [] });
    expect(draft.ingredients[0]).toMatchObject({ foodId: "food-Mehl", amount: 200, unit: "g", units: ["g", "kg", "mg"] });
  });

  it("keeps a plain-JSON answer that lists its ingredients as strings", async () => {
    // The shape that failed the whole import with "expected array to have >=1
    // items" once the request fell back to plain JSON mode.
    const ai = modelAnswering({ name: "Auflauf", ingredients: ["200 g Mehl", "2 Eier", "Salz nach Geschmack"] });

    const draft = await runRecipeImport("import-1", { ai: asProvider(ai) });

    // The line without a quantity is dropped; neither is given an invented one.
    expect(draft.unmatched).toEqual(["Mehl", "Eier"]);
  });

  it("reports a page it could read nothing from as a source failure", async () => {
    vi.mocked(fetchMealPage).mockResolvedValue({ url: "https://example.org/auflauf", title: "example.org", excerpt: "   ", recipeFound: false });
    const ai = modelAnswering({ name: "Auflauf", ingredients: [] });

    await expect(runRecipeImport("import-1", { ai: asProvider(ai) })).rejects.toThrow("source-no-ingredients");
    expect(ai.complete).not.toHaveBeenCalled();
  });
});

describe("units the draft may carry", () => {
  it("accepts the source's own spelling of a metric unit", async () => {
    food.findFirst.mockResolvedValue(weighed("Mehl"));
    const ai = modelAnswering({ name: "Auflauf", ingredients: [{ name: "Mehl", amount: 200, unit: "Gramm" }] });

    const draft = await runRecipeImport("import-1", { ai: asProvider(ai) });

    expect(draft.ingredients[0]).toMatchObject({ amount: 200, unit: "g" });
  });

  it("reports a spoon rather than inventing a weight for it", async () => {
    food.findFirst.mockResolvedValue(weighed("Olivenöl"));
    const ai = modelAnswering({ name: "Auflauf", ingredients: [{ name: "Olivenöl", amount: 2, unit: "EL" }] });

    const draft = await runRecipeImport("import-1", { ai: asProvider(ai) });

    // "Unbekannte Einheit" used to reach the user at save time instead.
    expect(draft.ingredients).toEqual([]);
    expect(draft.unconverted).toEqual(["Olivenöl (2 EL)"]);
  });

  it("reports a millilitre the food carries no density for", async () => {
    // The picture import's failure: the portion resolves to millilitres, but a
    // recipe ingredient needs a weight, so the save threw "density-required"
    // and took the whole extraction with it.
    food.findFirst.mockResolvedValue({ id: "food-bruehe", name: "Gemüsebrühe", basisUnit: "ML", densityGPerMl: null, servings: [] });
    const ai = modelAnswering({ name: "Risotto", ingredients: [{ name: "Gemüsebrühe", amount: 1.5, unit: "l" }] });

    const draft = await runRecipeImport("import-1", { ai: asProvider(ai) });

    expect(draft.ingredients).toEqual([]);
    expect(draft.unconverted).toEqual(["Gemüsebrühe (1.5 l)"]);
  });

  it("weighs a millilitre once the food carries a density", async () => {
    food.findFirst.mockResolvedValue({ id: "food-sahne", name: "Cremefine", basisUnit: "ML", densityGPerMl: 1.01, servings: [] });
    const ai = modelAnswering({ name: "Risotto", ingredients: [{ name: "Cremefine", amount: 250, unit: "ml" }] });

    const draft = await runRecipeImport("import-1", { ai: asProvider(ai) });

    expect(draft.ingredients[0]).toMatchObject({ amount: 250, unit: "ml" });
    expect(draft.unconverted).toEqual([]);
  });

  it("keeps a named portion the food itself defines", async () => {
    food.findFirst.mockResolvedValue({
      id: "food-eier", name: "Eier", basisUnit: "G", densityGPerMl: null,
      servings: [{ label: "Stück", unit: "Stück", amount: 1, gramEquivalent: 58, mlEquivalent: null }],
    });
    const ai = modelAnswering({ name: "Auflauf", ingredients: [{ name: "Eier", amount: 2, unit: "Stück" }] });

    const draft = await runRecipeImport("import-1", { ai: asProvider(ai) });

    expect(draft.ingredients[0]).toMatchObject({ amount: 2, unit: "Stück", units: ["g", "kg", "mg", "Stück"] });
  });
});

describe("the draft recipe the import stores", () => {
  it("saves it under the user's recipes, marked as an unconfirmed AI draft", async () => {
    food.findFirst.mockResolvedValue(weighed("Mehl"));
    const ai = modelAnswering({ name: "Auflauf", ingredients: [{ name: "Mehl", amount: 200, unit: "g" }] });

    const draft = await runRecipeImport("import-1", { ai: asProvider(ai) });

    expect(saveRecipe).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ name: "Auflauf", servings: 4, ingredients: [{ foodId: "food-Mehl", amount: 200, unit: "g" }] }),
      undefined,
      { status: "DRAFT", sourceType: "AI_RESEARCH", importId: "import-1" },
    );
    // Provenance the reader can check before confirming anything.
    expect(recipeSource.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ recipeId: "recipe-1", url: "https://example.org/auflauf" }) }));
    expect(draft.recipeId).toBe("recipe-1");
  });

  it("leaves a draft the user already confirmed alone", async () => {
    food.findFirst.mockResolvedValue(weighed("Mehl"));
    recipe.findFirst.mockResolvedValue({ id: "recipe-1", status: "ACTIVE" });
    const ai = modelAnswering({ name: "Auflauf", ingredients: [{ name: "Mehl", amount: 200, unit: "g" }] });

    const draft = await runRecipeImport("import-1", { ai: asProvider(ai) });

    expect(saveRecipe).not.toHaveBeenCalled();
    expect(draft.recipeId).toBe("recipe-1");
  });

  it("keeps the extraction when the draft recipe cannot be stored", async () => {
    food.findFirst.mockResolvedValue(weighed("Mehl"));
    vi.mocked(saveRecipe).mockRejectedValueOnce(new Error("Cannot resolve portion: density-required"));
    const ai = modelAnswering({ name: "Auflauf", ingredients: [{ name: "Mehl", amount: 200, unit: "g" }] });

    // The expensive part already succeeded; it must not be discarded over a
    // convenience that failed after it.
    const draft = await runRecipeImport("import-1", { ai: asProvider(ai) });

    expect(draft.recipeId).toBeUndefined();
    expect(draft.ingredients).toHaveLength(1);
    expect(recipeImport.update).toHaveBeenCalled();
  });

  it("updates the draft it wrote last time instead of adding a second one", async () => {
    food.findFirst.mockResolvedValue(weighed("Mehl"));
    recipe.findFirst.mockResolvedValue({ id: "recipe-1", status: "DRAFT" });
    const ai = modelAnswering({ name: "Auflauf", ingredients: [{ name: "Mehl", amount: 200, unit: "g" }] });

    await runRecipeImport("import-1", { ai: asProvider(ai) });

    expect(saveRecipe).toHaveBeenCalledWith("user-1", expect.anything(), "recipe-1", expect.anything());
    expect(recipeSource.create).not.toHaveBeenCalled();
  });
});
