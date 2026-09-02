import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, aiProposal, aiJob, recipe } = vi.hoisted(() => {
  const aiProposal = { findUnique: vi.fn(), update: vi.fn() };
  const aiJob = { findUnique: vi.fn(), update: vi.fn() };
  const recipe = { findFirst: vi.fn() };
  const food = { create: vi.fn(async () => ({ id: "food-estimate" })) };
  return { aiProposal, aiJob, recipe, food, prismaMock: { aiProposal, aiJob, recipe, food } };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/env", () => ({ resolveAiModel: () => "qwen3.5:4b" }));
vi.mock("./diary", () => ({
  addDiaryEntry: vi.fn(),
  formatDateKey: () => "2026-09-02",
}));
vi.mock("./recipes", () => ({
  saveRecipe: vi.fn(async () => ({ recipe: { id: "recipe-1", name: "Rührei mit Speck" }, food: null })),
}));

import { applyProposal } from "./ai-approval";
import { saveRecipe } from "./recipes";
import { addDiaryEntry } from "./diary";

/** Two components the resolver could not match: exactly what the reviewer is there for. */
const unresolved = [
  { name: "Ei", quantity: 2, unit: "Stück", estimatedGrams: 116, candidates: [{ foodId: "food-ei", name: "Ei", grams: 116 }] },
  { name: "Speck", quantity: 30, unit: "g", estimatedGrams: 30, candidates: [{ foodId: "food-speck", name: "Speck", grams: 30 }] },
];

function proposal(options: { components?: unknown[]; metadata?: unknown } = {}) {
  aiProposal.findUnique.mockResolvedValue({
    id: "proposal-1",
    approvalStatus: "PENDING",
    proposed: { components: options.components ?? unresolved },
    job: {
      id: "job-1",
      userId: "user-1",
      metadata: options.metadata ?? { addToMeal: true, createRecipe: true, extraction: { name: "Rührei mit Speck" } },
      mealInput: { id: "input-1", text: "Rührei mit Speck", meal: "BREAKFAST", diaryDate: new Date("2026-09-02") },
      user: { id: "user-1", profile: { language: "de" } },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  aiJob.findUnique.mockResolvedValue({ metadata: {} });
  recipe.findFirst.mockResolvedValue(null);
});

describe("the recipe a quick meal keeps", () => {
  it("is built from the foods the reviewer chose, not from what the resolver managed alone", async () => {
    // The worker built the recipe before anyone had reviewed anything, so a meal
    // whose foods the reviewer picked herself produced no recipe at all - and
    // nothing on the page said why the recipe list stayed empty.
    proposal();
    const outcome = await applyProposal("proposal-1", { selection: (index) => ["food-ei", "food-speck"][index] });

    expect(vi.mocked(saveRecipe)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveRecipe).mock.calls[0][1].ingredients).toEqual([
      { foodId: "food-ei", amount: 116, unit: "g" },
      { foodId: "food-speck", amount: 30, unit: "g" },
    ]);
    expect(outcome).toMatchObject({ recipeId: "recipe-1", recipeName: "Rührei mit Speck" });
  });

  it("holds exactly what was logged, so a declined component is in neither", async () => {
    proposal();
    const outcome = await applyProposal("proposal-1", { selection: (index) => (index === 0 ? "food-ei" : "") });

    expect(outcome.logged).toEqual(["Ei"]);
    expect(vi.mocked(addDiaryEntry)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveRecipe).mock.calls[0][1].ingredients).toEqual([{ foodId: "food-ei", amount: 116, unit: "g" }]);
  });

  it("says nothing could go in it rather than leaving the reader to guess", async () => {
    proposal();
    const outcome = await applyProposal("proposal-1", { selection: () => "" });

    expect(vi.mocked(saveRecipe)).not.toHaveBeenCalled();
    expect(outcome.recipeSkipped).toBe(true);
    expect(outcome.recipeId).toBeUndefined();
  });

  it("updates the one the worker already wrote instead of adding a second", async () => {
    aiJob.findUnique.mockResolvedValue({ metadata: { outcome: { recipeId: "recipe-1" } } });
    recipe.findFirst.mockResolvedValue({ id: "recipe-1", status: "DRAFT" });
    proposal({ metadata: { addToMeal: true, createRecipe: true, outcome: { recipeId: "recipe-1" }, extraction: { name: "Rührei mit Speck" } } });

    await applyProposal("proposal-1", { selection: (index) => ["food-ei", "food-speck"][index] });

    expect(vi.mocked(saveRecipe).mock.calls[0][2]).toBe("recipe-1");
  });

  it("leaves a recipe the user already confirmed exactly as they confirmed it", async () => {
    recipe.findFirst.mockResolvedValue({ id: "recipe-1", status: "ACTIVE" });
    proposal({ metadata: { addToMeal: true, createRecipe: true, outcome: { recipeId: "recipe-1" }, extraction: { name: "Rührei" } } });

    const outcome = await applyProposal("proposal-1", { selection: (index) => ["food-ei", "food-speck"][index] });

    expect(vi.mocked(saveRecipe)).not.toHaveBeenCalled();
    expect(outcome.recipeId).toBe("recipe-1");
  });

  it("keeps none, and reports none, when the submitter did not ask for one", async () => {
    proposal({ metadata: { addToMeal: true, createRecipe: false } });

    const outcome = await applyProposal("proposal-1", { selection: (index) => ["food-ei", "food-speck"][index] });

    expect(vi.mocked(saveRecipe)).not.toHaveBeenCalled();
    expect(outcome.recipeId).toBeUndefined();
    expect(outcome.recipeSkipped).toBeUndefined();
  });

  it("does not fail the approval when the recipe cannot be stored", async () => {
    vi.mocked(saveRecipe).mockRejectedValueOnce(new Error("Cannot resolve portion: density-required"));
    proposal();

    const outcome = await applyProposal("proposal-1", { selection: (index) => ["food-ei", "food-speck"][index] });

    expect(outcome.logged).toEqual(["Ei", "Speck"]);
    expect(outcome.recipeId).toBeUndefined();
  });
});
