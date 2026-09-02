import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

const { prismaMock, recipeImport, food, recipe, recipeSource } = vi.hoisted(() => {
  const recipeImport = { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() };
  const food = { findFirst: vi.fn(), findMany: vi.fn() };
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
  food.findMany.mockResolvedValue([]);
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
  it("uses structured facts deterministically, preserves unresolved lines, and keeps user servings", async () => {
    vi.mocked(fetchMealPage).mockResolvedValue({
      url: "https://example.org/auflauf", title: "Source name", excerpt: "fallback", recipeFound: true,
      structuredRecipe: { name: "Source name", description: "Source description", instructions: "1. Mix.", ingredientLines: ["200 g Mehl", "2 Eier", "1,5 EL Olivenöl", "½ TL Salz", "Salz und Pfeffer nach Geschmack"] },
    });
    food.findFirst.mockResolvedValue(null);
    const ai = modelAnswering({});
    const draft = await runRecipeImport("import-1", { ai: asProvider(ai) });
    expect(ai.complete).not.toHaveBeenCalled();
    expect(draft).toMatchObject({ name: "Source name", description: "Source description", instructions: "1. Mix.", servings: 4 });
    expect(draft.unmatched).toEqual(["Mehl", "Eier", "Olivenöl", "Salz"]);
    expect(draft.unparsedIngredients).toEqual(["Salz und Pfeffer nach Geschmack"]);
  });
  it("falls back to the model when the source's own lines carry no quantities", async () => {
    // Committing to the deterministic reading regardless stored a draft recipe
    // with no ingredients at all - one that neither `confirmRecipe` nor the
    // recipe form accepts, so the user could only delete it.
    vi.mocked(fetchMealPage).mockResolvedValue({
      url: "https://example.org/auflauf", title: "Pfannengericht", recipeFound: true,
      excerpt: "Recipe: Pfannengericht\nIngredients:\n- Salz und Pfeffer\n- Öl zum Braten\n- etwas Butter",
      structuredRecipe: { name: "Pfannengericht", ingredientLines: ["Salz und Pfeffer", "Öl zum Braten", "etwas Butter"] },
    });
    food.findFirst.mockResolvedValue(weighed("Butter"));
    const ai = modelAnswering({ name: "Pfannengericht", ingredients: [{ name: "Butter", amount: 20, unit: "g" }] });

    const draft = await runRecipeImport("import-1", { ai: asProvider(ai) });

    expect(ai.complete).toHaveBeenCalledTimes(1);
    expect(ai.complete.mock.calls[0][0].prompt).toContain("- Salz und Pfeffer");
    expect(draft.ingredients[0]).toMatchObject({ foodId: "food-Butter", amount: 20, unit: "g" });
  });

  it("keeps the page in the prompt when an image forces the model to run", async () => {
    // `structuredRecipe` used to suppress the excerpt outright, so an import
    // carrying both a link and a photo reached the model with neither.
    recipeImport.findUnique.mockResolvedValue({
      id: "import-1", userId: "user-1", text: null, sourceUrl: "https://example.org/auflauf", servings: 4,
      imageData: Buffer.from("photo"),
    });
    vi.mocked(fetchMealPage).mockResolvedValue({
      url: "https://example.org/auflauf", title: "Auflauf", excerpt: "Recipe: Auflauf\nIngredients:\n- 200 g Mehl", recipeFound: true,
      structuredRecipe: { name: "Auflauf", ingredientLines: ["200 g Mehl"] },
    });
    food.findFirst.mockResolvedValue(weighed("Mehl"));
    const ai = modelAnswering({ name: "Auflauf", ingredients: [{ name: "Mehl", amount: 200, unit: "g" }] });

    await runRecipeImport("import-1", { ai: asProvider(ai) });

    expect(ai.complete.mock.calls[0][0].prompt).toContain("- 200 g Mehl");
  });

  it("holds the deterministic draft to the same limits the recipe form enforces", async () => {
    // The branch asserted the schema's type without ever running it, so a
    // source's own name and steps reached the database at lengths that made the
    // stored draft impossible to save again.
    recipeImport.findUnique.mockResolvedValue({
      id: "import-1", userId: "user-1", text: "n".repeat(5_000), sourceUrl: "https://example.org/auflauf", servings: 4, imageData: null,
    });
    vi.mocked(fetchMealPage).mockResolvedValue({
      url: "https://example.org/auflauf", title: "Auflauf", excerpt: "fallback", recipeFound: true,
      structuredRecipe: {
        ingredientLines: ["200 g Mehl"],
        instructions: Array.from({ length: 60 }, (_, index) => `${index + 1}. ${"s".repeat(2_000)}`).join("\n"),
      },
    });
    const draft = await runRecipeImport("import-1", { ai: asProvider(modelAnswering({})) });

    expect(draft.name.length).toBeLessThanOrEqual(200);
    expect(draft.instructions.length).toBeLessThanOrEqual(20_000);
  });

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

describe("what the catalogue lookup can reach", () => {
  /** A stored food with the servings it defines, matched the way the resolver sees it. */
  const catalogue = [
    { id: "food-ei", name: "Ei", basisUnit: "G", densityGPerMl: null, servings: [{ label: "Stück", unit: "Stück", amount: 1, gramEquivalent: 58, mlEquivalent: null }] },
    { id: "food-pet", name: "Petersilie", basisUnit: "G", densityGPerMl: null, servings: [{ label: "Bund", unit: "Bund", amount: 1, gramEquivalent: 25, mlEquivalent: null }] },
    { id: "food-mehl", name: "Mehl", basisUnit: "G", densityGPerMl: null, servings: [] },
  ];

  it("matches a German plural, an adjective and a counted portion in one recipe", async () => {
    food.findMany.mockResolvedValue(catalogue);
    vi.mocked(fetchMealPage).mockResolvedValue({
      url: "https://example.org/auflauf", title: "Auflauf", excerpt: "x", recipeFound: true,
      structuredRecipe: { name: "Auflauf", ingredientLines: ["200 g Mehl", "2 Eier", "1 Bund glatte Petersilie"] },
    });

    const draft = await runRecipeImport("import-1", { ai: asProvider(modelAnswering({})) });

    expect(draft.unmatched).toEqual([]);
    expect(draft.ingredients).toMatchObject([
      { foodId: "food-mehl", amount: 200, unit: "g" },
      // "2 Eier" parses as a piece; the food calls that "Stück", which is also
      // the word its own unit dropdown offers.
      { foodId: "food-ei", amount: 2, unit: "Stück" },
      { foodId: "food-pet", amount: 1, unit: "Bund" },
    ]);
  });

  it("looks a leftover food up by its identity name, not the whole messy line", async () => {
    food.findMany.mockResolvedValue([]);
    food.findFirst.mockResolvedValue(weighed("Zwiebel"));
    vi.mocked(fetchMealPage).mockResolvedValue({
      url: "https://example.org/auflauf", title: "Auflauf", excerpt: "x", recipeFound: true,
      structuredRecipe: { name: "Auflauf", ingredientLines: ["200 g Zwiebel, fein gehackt"] },
    });

    await runRecipeImport("import-1", { ai: asProvider(modelAnswering({})) });

    // "zwiebel fein gehackt" matches no stored food; "zwiebel" is one.
    expect(food.findFirst.mock.calls[0][0].where.AND[1].normalizedName).toBe("zwiebel");
  });

  it("keeps the weight a package line states beside its contents", async () => {
    food.findMany.mockResolvedValue([{ id: "food-tom", name: "Tomaten", basisUnit: "G", densityGPerMl: null, servings: [] }]);
    vi.mocked(fetchMealPage).mockResolvedValue({
      url: "https://example.org/auflauf", title: "Sugo", excerpt: "x", recipeFound: true,
      structuredRecipe: { name: "Sugo", ingredientLines: ["2 Dosen gehackte Tomaten (400 g)"] },
    });

    const draft = await runRecipeImport("import-1", { ai: asProvider(modelAnswering({})) });

    // The can has no weight this code may invent; the bracket had one all along.
    expect(draft.ingredients[0]).toMatchObject({ foodId: "food-tom", amount: 800, unit: "g" });
    expect(draft.unconverted).toEqual([]);
  });

  it("names the ingredients the model was asked to settle", async () => {
    food.findMany.mockResolvedValue([{ id: "food-tom", name: "Tomaten Konserve", basisUnit: "G", densityGPerMl: null, servings: [] }]);
    vi.mocked(fetchMealPage).mockResolvedValue({
      url: "https://example.org/auflauf", title: "Sugo", excerpt: "x", recipeFound: true,
      structuredRecipe: { name: "Sugo", ingredientLines: ["200 g passierte Tomaten"] },
    });
    const ai = { complete: vi.fn(async () => ({ ingredients: [{ id: 0, candidateIndex: 0, confidence: "high" }] })) };

    const draft = await runRecipeImport("import-1", { ai: asProvider(ai) });

    expect(draft.aiAssistedIngredients).toEqual(["Tomaten Konserve"]);
    expect(draft.resolutionDiagnostics).toMatchObject({ ingredientCount: 1, aiAssistedCount: 1 });
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
