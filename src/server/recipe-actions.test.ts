import { beforeEach, describe, expect, it, vi } from "vitest";

const { addDiaryEntry, foodFindFirst, mealInputCreate, aiJobCreate, revalidatePath } = vi.hoisted(() => ({
  addDiaryEntry: vi.fn(),
  foodFindFirst: vi.fn(),
  mealInputCreate: vi.fn(),
  aiJobCreate: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }) }));
vi.mock("./session", () => ({ requireUser: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/db", () => ({
  prisma: {
    food: { findFirst: foodFindFirst },
    ingestionInput: { create: mealInputCreate },
    aiJob: { create: aiJobCreate },
  },
}));
vi.mock("./recipes", () => ({ confirmRecipe: vi.fn(), deleteRecipe: vi.fn(), saveRecipe: vi.fn() }));
vi.mock("./diary", () => ({
  addDiaryEntry,
  NotFoundError: class NotFoundError extends Error {},
  PortionError: class PortionError extends Error {},
}));

import { logRecipeAction } from "./recipe-actions";

describe("logging a recipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    foodFindFirst.mockResolvedValue({ id: "recipe-food-1" });
    addDiaryEntry.mockResolvedValue({ id: "entry-1" });
  });

  it("adds one recipe Food directly instead of creating an ingredient-review job", async () => {
    const form = new FormData();
    form.set("recipeId", "recipe-1");
    form.set("quantity", "1.5");
    form.set("meal", "DINNER");
    form.set("date", "2026-09-02");

    await expect(logRecipeAction({}, form)).rejects.toThrow("redirect:/?date=2026-09-02");

    expect(foodFindFirst).toHaveBeenCalledWith({
      where: {
        ownerId: "user-1",
        sourceType: "RECIPE",
        externalProvider: "NUTRICORE_RECIPE",
        externalId: "recipe-1",
      },
      select: { id: true },
    });
    expect(addDiaryEntry).toHaveBeenCalledWith({
      userId: "user-1",
      foodId: "recipe-food-1",
      quantity: 1.5,
      unit: "serving",
      meal: "DINNER",
      date: "2026-09-02",
    });
    expect(mealInputCreate).not.toHaveBeenCalled();
    expect(aiJobCreate).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });
});
