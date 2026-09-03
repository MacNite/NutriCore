import { describe, expect, it } from "vitest";
import { aiJobDestination } from "./ai-types";

const recipeImport = (metadata: unknown, recipeId?: string | null) =>
  aiJobDestination({ entityType: "RECIPE_IMPORT", entityId: "import-1", metadata, recipeId });

const quickMeal = (metadata: unknown) =>
  aiJobDestination({ entityType: "MEAL_INPUT", entityId: "input-1", metadata });

describe("where a recipe import ends", () => {
  it("is the recipe it produced", () => {
    expect(recipeImport({ outcome: { recipeId: "recipe-1" } })).toEqual({
      kind: "RECIPE_PREVIEW",
      recipeId: "recipe-1",
      href: "/recipes/recipe-1",
    });
  });

  it("is nowhere yet while it has produced nothing to open", () => {
    expect(recipeImport({})).toBeNull();
  });

  it("follows the draft the caller already holds, which is written first", () => {
    // The draft lands on the import before the job is marked complete, so the
    // page holding it knows the destination a poll earlier than the outcome.
    expect(recipeImport({}, "recipe-2")).toMatchObject({ recipeId: "recipe-2" });
  });
});

describe("where a quick meal ends", () => {
  it("is its review, where the meal is decided", () => {
    expect(quickMeal({ addToMeal: true, createRecipe: false })).toEqual({
      kind: "MEAL_REVIEW",
      href: "/ai-review/input-1",
    });
  });

  it("is still its review when it kept a recipe as well as logging the meal", () => {
    // Both were asked for, and the diary entry is the one with a decision
    // attached: sending the reader to the recipe would hide what was logged.
    expect(quickMeal({ addToMeal: true, createRecipe: true, outcome: { recipeId: "recipe-1" } })).toMatchObject({
      kind: "MEAL_REVIEW",
    });
  });

  it("is the recipe when that is all the submitter asked for", () => {
    expect(quickMeal({ addToMeal: false, createRecipe: true, outcome: { recipeId: "recipe-1" } })).toEqual({
      kind: "RECIPE_PREVIEW",
      recipeId: "recipe-1",
      href: "/recipes/recipe-1",
    });
  });

  it("falls back to the review when the recipe it asked for could not be built", () => {
    // Nothing resolved to a food, so there is no recipe to open and the review
    // is the only page that describes the run at all.
    expect(quickMeal({ addToMeal: false, createRecipe: true })).toMatchObject({ kind: "MEAL_REVIEW" });
  });

  it("stops naming a recipe the reviewer declined, which no longer exists", () => {
    // Rejecting the proposal deletes that draft and clears its id.
    expect(quickMeal({ addToMeal: false, createRecipe: true, outcome: {} })).toMatchObject({ kind: "MEAL_REVIEW" });
  });

  it("reads a job queued before the options existed as the review it always was", () => {
    expect(quickMeal({})).toMatchObject({ kind: "MEAL_REVIEW" });
  });
});

it("leads nowhere for a job that produces neither", () => {
  expect(aiJobDestination({ entityType: "FOOD_ENRICHMENT", entityId: "food-1", metadata: {} })).toBeNull();
});
