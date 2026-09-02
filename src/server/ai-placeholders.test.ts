import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, aiJob, recipeImport } = vi.hoisted(() => {
  const aiJob = { findMany: vi.fn() };
  const recipeImport = { findMany: vi.fn() };
  return { aiJob, recipeImport, prismaMock: { aiJob, recipeImport } };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { mealPlaceholders, recipePlaceholders } from "./ai-placeholders";

const mealJob = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1",
  status: "RUNNING",
  entityType: "MEAL_INPUT",
  entityId: "input-1",
  metadata: { addToMeal: true, createRecipe: false },
  mealInput: { text: "2 Scheiben Brot mit Butter", sourceUrl: null, meal: "BREAKFAST" },
  ...overrides,
});

beforeEach(() => {
  aiJob.findMany.mockReset();
  recipeImport.findMany.mockReset();
  recipeImport.findMany.mockResolvedValue([]);
});

describe("mealPlaceholders", () => {
  it("stands in for a running extraction, pointing at its review page", async () => {
    aiJob.findMany.mockResolvedValue([mealJob()]);

    await expect(mealPlaceholders("user-1", "2026-03-04")).resolves.toEqual([
      {
        id: "job-1",
        status: "RUNNING",
        href: "/ai-review/input-1",
        source: "2 Scheiben Brot mit Butter",
        meal: "BREAKFAST",
      },
    ]);
  });

  it("asks only for this user's in-flight meal jobs on the day being shown", async () => {
    aiJob.findMany.mockResolvedValue([]);

    await mealPlaceholders("user-1", "2026-03-04");

    const where = aiJob.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe("user-1");
    expect(where.entityType).toBe("MEAL_INPUT");
    expect(where.status).toEqual({ in: ["QUEUED", "RUNNING"] });
    expect(where.mealInput.diaryDate).toEqual(new Date("2026-03-04T00:00:00.000Z"));
  });

  it("leaves out a submission that asked not to be logged", async () => {
    aiJob.findMany.mockResolvedValue([mealJob({ metadata: { addToMeal: false, createRecipe: true } })]);

    await expect(mealPlaceholders("user-1", "2026-03-04")).resolves.toEqual([]);
  });

  it("treats a job without options as one that will be logged", async () => {
    aiJob.findMany.mockResolvedValue([mealJob({ metadata: null })]);

    await expect(mealPlaceholders("user-1", "2026-03-04")).resolves.toHaveLength(1);
  });

  it("falls back to the URL when the submission was a link only", async () => {
    aiJob.findMany.mockResolvedValue([
      mealJob({ mealInput: { text: "", sourceUrl: "https://example.test/soup", meal: "LUNCH" } }),
    ]);

    const [placeholder] = await mealPlaceholders("user-1", "2026-03-04");
    expect(placeholder.source).toBe("https://example.test/soup");
  });
});

describe("recipePlaceholders", () => {
  it("includes a quick meal only when it was asked to keep a recipe", async () => {
    aiJob.findMany.mockResolvedValue([
      mealJob({ id: "job-keep", metadata: { addToMeal: true, createRecipe: true } }),
      mealJob({ id: "job-log-only", entityId: "input-2" }),
    ]);

    const placeholders = await recipePlaceholders("user-1");
    expect(placeholders).toEqual([
      { id: "job-keep", status: "RUNNING", href: "/ai-review/input-1", source: "2 Scheiben Brot mit Butter" },
    ]);
  });

  it("sends a recipe import to the page that reports its progress", async () => {
    aiJob.findMany.mockResolvedValue([
      { id: "job-2", status: "QUEUED", entityType: "RECIPE_IMPORT", entityId: "import-1", metadata: null, mealInput: null },
    ]);
    recipeImport.findMany.mockResolvedValue([{ id: "import-1", text: "Linsensuppe", sourceUrl: null }]);

    await expect(recipePlaceholders("user-1")).resolves.toEqual([
      { id: "job-2", status: "QUEUED", href: "/recipes/new?import=import-1", source: "Linsensuppe" },
    ]);
    expect(recipeImport.findMany.mock.calls[0][0].where.userId).toBe("user-1");
  });

  it("drops an import whose record this user cannot see", async () => {
    aiJob.findMany.mockResolvedValue([
      { id: "job-2", status: "QUEUED", entityType: "RECIPE_IMPORT", entityId: "import-1", metadata: null, mealInput: null },
    ]);
    recipeImport.findMany.mockResolvedValue([]);

    await expect(recipePlaceholders("user-1")).resolves.toEqual([]);
  });

  it("does not query imports when no import is running", async () => {
    aiJob.findMany.mockResolvedValue([mealJob({ metadata: { createRecipe: true } })]);

    await recipePlaceholders("user-1");
    expect(recipeImport.findMany).not.toHaveBeenCalled();
  });
});
