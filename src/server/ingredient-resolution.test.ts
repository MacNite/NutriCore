import { describe, expect, it, vi } from "vitest";
import type { OllamaProvider } from "@/providers/ollama";
import lineFixtures from "./__fixtures__/ingredient-lines.json";
import recipeFixtures from "./__fixtures__/recipe-sources.json";
import { classifyIngredientLine, matchFoodCandidates, resolveIngredientLines } from "./ingredient-resolution";

describe("ingredient regression corpus", () => {
  it.each(lineFixtures)("parses $input conservatively", ({ input, expected }) => {
    const result = classifyIngredientLine(input);
    expect(result.status).toBe(expected.status);
    if ("amount" in expected) expect(result.parsed?.amount).toBe(expected.amount);
    if ("unit" in expected) expect(result.parsed?.unit).toBe(expected.unit);
    if ("nameIncludes" in expected) expect(result.normalizedName).toContain(expected.nameIncludes);
    if ("mustNotInventAmount" in expected) expect(result.parsed?.amount).toBeUndefined();
    if ("mustNotInventWeight" in expected) expect(result.parsed?.unit).not.toBe("g");
  });

  it.each(recipeFixtures)("keeps every source line and never quantifies absent amounts: $name", async (fixture) => {
    const result = await resolveIngredientLines(fixture.ingredients, []);
    const classifications = fixture.ingredients.map(classifyIngredientLine);
    expect(result.ingredients).toHaveLength(fixture.expected.sourceCount);
    expect(result.diagnostics.unquantifiedCount).toBe(fixture.expected.unquantifiedCount);
    expect(classifications.filter((item) => item.status === "resolved")).toHaveLength(fixture.expected.deterministicResolutionCount);
    expect(classifications.filter((item) => item.status === "ambiguous")).toHaveLength(fixture.expected.aiRequiredCount);
    expect(classifications.filter((item) => ["unquantified", "failed"].includes(item.status))).toHaveLength(fixture.expected.unresolvedCount);
    for (const item of result.ingredients.filter((entry) => entry.status === "unquantified")) expect(item.parsed).toBeUndefined();
  });
});

describe("deterministic food matching", () => {
  const foods = [
    { id: "onion", name: "Zwiebel" }, { id: "red", name: "Rote Zwiebel" }, { id: "spring", name: "Frühlingszwiebel" },
  ];

  it("ranks normalized exact identity ahead of modifier matches", () => {
    expect(matchFoodCandidates("Zwiebel, fein gehackt", foods)[0]).toMatchObject({ id: "onion", exact: true, score: 1 });
  });

  it("commits to a lone near-match a stray adjective used to disqualify", async () => {
    // "glatte Petersilie" against a stored "Petersilie" scores exactly 0.7, two
    // hundredths under the old threshold - so the ingredient was reported as
    // not found while the food sat in the user's catalogue.
    const result = await resolveIngredientLines(["1 Bund glatte Petersilie"], [{ id: "parsley", name: "Petersilie" }]);
    expect(result.ingredients[0]).toMatchObject({ foodId: "parsley", resolution: "deterministic", status: "resolved" });
  });

  it("safely normalizes a common German plural", () => {
    expect(matchFoodCandidates("Frühlingszwiebeln", foods)[0]).toMatchObject({ id: "spring", exact: true });
  });
});

function provider(answer: unknown) {
  return { complete: vi.fn(async () => answer) } as unknown as OllamaProvider;
}

describe("selective batched AI resolution", () => {
  const deterministicFoods = Array.from({ length: 8 }, (_, index) => ({ id: `food-${index}`, name: `Food${index}` }));
  const ambiguousFoods = [
    { id: "gouda", name: "Gouda Käse" }, { id: "feta-cheese", name: "Feta Käse" },
    { id: "chopped-tomato", name: "Gehackte Tomaten" }, { id: "tomato-can", name: "Tomaten Konserve" },
  ];

  it("makes no call for ten strong deterministic matches", async () => {
    const ai = provider({ ingredients: [] });
    const result = await resolveIngredientLines(Array.from({ length: 10 }, (_, index) => `${index + 1} Food${index}`),
      Array.from({ length: 10 }, (_, index) => ({ id: `food-${index}`, name: `Food${index}` })), ai);
    expect(ai.complete).not.toHaveBeenCalled();
    expect(result.diagnostics.ollamaCallsUsed).toBe(0);
  });

  it("sends only two ambiguous lines from a ten-line recipe in one call", async () => {
    const ai = provider({ ingredients: [
      { id: 8, candidateIndex: 0, confidence: "high" },
      { id: 9, candidateIndex: 0, confidence: "medium" },
    ] });
    const lines = [...deterministicFoods.map((food, index) => `${index + 1} ${food.name}`), "1 Packung Käse", "1 Dose Tomaten"];
    const result = await resolveIngredientLines(lines, [...deterministicFoods, ...ambiguousFoods], ai);
    expect(ai.complete).toHaveBeenCalledTimes(1);
    const request = JSON.parse(vi.mocked(ai.complete).mock.calls[0][0].prompt);
    expect(request.ingredients.map((item: { sourceLine: string }) => item.sourceLine)).toEqual(["1 Packung Käse", "1 Dose Tomaten"]);
    expect(request.ingredients.flatMap((item: { sourceLine: string }) => item.sourceLine)).not.toContain("Food0");
    expect(result.diagnostics).toMatchObject({ ingredientCount: 10, deterministicallyResolvedCount: 8, aiAssistedCount: 2, ollamaCallsUsed: 1 });
    // Source amount/unit survived untouched because the response schema has no writable quantity fields.
    expect(result.ingredients[8].parsed).toMatchObject({ amount: 1, unit: "Packung" });
  });

  it("asks about a single candidate it could not commit to on its own", async () => {
    // Requiring two candidates excluded the most fixable case there is: one
    // plausible food that the deterministic rules stopped short of accepting.
    const ai = provider({ ingredients: [{ id: 0, candidateIndex: 0, confidence: "high" }] });
    const result = await resolveIngredientLines(["1 Dose passierte Tomaten"], [{ id: "tomato-can", name: "Tomaten Konserve" }], ai);
    expect(ai.complete).toHaveBeenCalledTimes(1);
    expect(result.ingredients[0]).toMatchObject({ foodId: "tomato-can", resolution: "ai-assisted" });
  });

  it("isolates invalid, duplicate, unknown, and low-confidence answers", async () => {
    const ai = provider({ ingredients: [
      { id: 0, candidateIndex: 99, confidence: "high" },
      { id: 0, candidateIndex: 0, confidence: "high" },
      { id: 999, candidateIndex: 0, confidence: "high" },
      { id: 1, candidateIndex: 0, confidence: "low" },
    ] });
    const result = await resolveIngredientLines(["1 Packung Käse", "1 Dose Tomaten"], ambiguousFoods, ai);
    expect(result.ingredients.every((item) => item.resolution === "unresolved")).toBe(true);
  });

  it("leaves the batch unresolved when model output is malformed", async () => {
    const ai = { complete: vi.fn().mockRejectedValue(new Error("invalid JSON")) } as unknown as OllamaProvider;
    const result = await resolveIngredientLines(["1 Packung Käse"], ambiguousFoods, ai);
    expect(result.ingredients[0]).toMatchObject({ sourceLine: "1 Packung Käse", resolution: "unresolved", parsed: { amount: 1 } });
  });
});
