import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

const { prismaMock, recipeImport, food } = vi.hoisted(() => {
  const recipeImport = { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() };
  const food = { findFirst: vi.fn(async () => null) };
  return { recipeImport, food, prismaMock: { recipeImport, food } };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("./meal-url", () => ({ fetchMealPage: vi.fn() }));

import { runRecipeImport } from "./recipe-import";
import { fetchMealPage } from "./meal-url";
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

beforeEach(() => {
  vi.clearAllMocks();
  food.findFirst.mockResolvedValue(null);
  recipeImport.update.mockResolvedValue({});
  recipeImport.findUnique.mockResolvedValue({
    id: "import-1",
    userId: "user-1",
    text: null,
    sourceUrl: "https://example.org/auflauf",
    servings: 4,
    imageData: null,
  });
});

describe("recipe import from a URL", () => {
  it("reads the page through the same extractor Quick meal uses", async () => {
    vi.mocked(fetchMealPage).mockResolvedValue({
      url: "https://example.org/auflauf",
      title: "Auflauf",
      excerpt: "Recipe: Auflauf\nIngredients:\n- 200 g Mehl\nInstructions:\n1. Mischen.",
      recipeFound: true,
    });
    const ai = modelAnswering({ name: "Auflauf", ingredients: [{ name: "Mehl", amount: 200, unit: "g" }] });

    const draft = await runRecipeImport("import-1", { ai: asProvider(ai) });

    // The recipe's own JSON-LD, plus the steps only a recipe draft needs.
    expect(fetchMealPage).toHaveBeenCalledWith("https://example.org/auflauf", undefined, { includeInstructions: true });
    expect(ai.complete.mock.calls[0][0].prompt).toContain("- 200 g Mehl");
    expect(draft).toMatchObject({ name: "Auflauf", servings: 4, unmatched: ["Mehl"] });
  });

  it("keeps a plain-JSON answer that lists its ingredients as strings", async () => {
    vi.mocked(fetchMealPage).mockResolvedValue({ url: "https://example.org/auflauf", title: "Auflauf", excerpt: "Ingredients:\n- 2 Eier", recipeFound: true });
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
