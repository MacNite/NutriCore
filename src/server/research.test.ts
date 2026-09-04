import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveResearchRecipe, validateReferenceUrl } from "./research";
import { saveRecipe } from "./recipes";
import { prisma } from "@/lib/db";
import { PortionError } from "./diary";

vi.mock("@/lib/db", () => ({ prisma: { recipeSource: { createMany: vi.fn() } } }));
vi.mock("./recipes", () => ({ saveRecipe: vi.fn(async () => ({ recipe: { id: "recipe-1" }, food: null, skipped: [] })) }));

/** `env()` caches its parse, so each case needs a fresh module graph. */
async function load(values: Record<string, string>) {
  vi.resetModules();
  vi.stubEnv("APP_SECRET", "x".repeat(32));
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  return import("./research");
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllEnvs());

describe("research source storage validation", () => {
  it("accepts http(s) references without DNS and rejects unsafe syntax", () => {
    expect(validateReferenceUrl("https://example.org/recipe")).toBe("https://example.org/recipe");
    expect(validateReferenceUrl("javascript:alert(1)")).toBeNull();
    expect(validateReferenceUrl("https://user:secret@example.org")).toBeNull();
  });
});

describe("availability", () => {
  const user = { aiEnabled: true, researchEnabled: false };

  it("offers AI research on an AI-configured server without the web-research flag", async () => {
    // Estimating from the model alone sends nothing to the web, so RESEARCH_ENABLED
    // must not decide whether AI search exists at all.
    const { researchAvailability } = await load({ AI_ENABLED: "true", RESEARCH_ENABLED: "false" });
    expect(researchAvailability(user).available).toBe(true);
  });

  it("reports the server when AI is switched off there", async () => {
    const { researchAvailability } = await load({ AI_ENABLED: "false" });
    expect(researchAvailability(user)).toEqual({ available: false, reason: "SERVER_DISABLED" });
  });

  it("names the user's own switch when they turned AI off", async () => {
    const { researchAvailability } = await load({ AI_ENABLED: "true" });
    expect(researchAvailability({ ...user, aiEnabled: false })).toEqual({ available: false, reason: "AI_DISABLED" });
  });

  it("keeps web sources behind both the server flag and consent", async () => {
    const enabled = await load({ AI_ENABLED: "true", RESEARCH_ENABLED: "true" });
    expect(enabled.webSourcesAvailable({ researchEnabled: true })).toBe(true);
    expect(enabled.webSourcesAvailable({ researchEnabled: false })).toBe(false);

    const off = await load({ AI_ENABLED: "true", RESEARCH_ENABLED: "false" });
    expect(off.webSourcesAvailable({ researchEnabled: true })).toBe(false);
  });
});

describe("storing an accepted research recipe", () => {
  const payload = {
    result: { name: "Gemüsesuppe", description: "", servings: 2, kind: "recipe" as const },
    matches: [
      { name: "Brühe", amount: 500, unit: "ml", foodId: "food-stock", foodName: "Brühe" },
      { name: "Möhren", amount: 200, unit: "g", foodId: "food-carrot", foodName: "Möhren" },
      { name: "Petersilie", amount: 1, unit: "piece", foodId: null, foodName: null },
    ],
    yieldWeightG: 700,
  };

  beforeEach(() => vi.mocked(saveRecipe).mockClear());

  it("goes through the recipe save rather than writing rows itself", async () => {
    // Writing them directly stored a weight only for a `g` amount, so every
    // millilitre and every counted ingredient was saved with none - read back
    // later as zero grams and zero nutrition, and unsavable on the first edit.
    await saveResearchRecipe("user-1", payload as never, [{ title: "Quelle", url: "https://example.org/s" }]);

    expect(vi.mocked(saveRecipe).mock.calls[0][1]).toMatchObject({
      name: "Gemüsesuppe",
      servings: 2,
      yieldWeightG: 700,
      ingredients: [
        { foodId: "food-stock", amount: 500, unit: "ml" },
        { foodId: "food-carrot", amount: 200, unit: "g" },
      ],
    });
    // A draft, so the run's own estimated food stays the single loggable entry
    // for the dish rather than being duplicated by the recipe's.
    expect(vi.mocked(saveRecipe).mock.calls[0][3]).toMatchObject({ status: "DRAFT", sourceType: "AI_RESEARCH" });
    expect(prisma.recipeSource.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ recipeId: "recipe-1", url: "https://example.org/s" })],
    }));
  });

  it("keeps the loggable estimate when no ingredient can be weighed", async () => {
    vi.mocked(saveRecipe).mockRejectedValueOnce(new PortionError("density-required"));
    await expect(saveResearchRecipe("user-1", payload as never, [])).resolves.toBeNull();
  });

  it("writes no recipe at all when nothing matched a food", async () => {
    const unmatched = { ...payload, matches: [{ name: "Petersilie", amount: 1, unit: "piece", foodId: null, foodName: null }] };
    await expect(saveResearchRecipe("user-1", unmatched as never, [])).resolves.toBeNull();
    expect(saveRecipe).not.toHaveBeenCalled();
  });
});
