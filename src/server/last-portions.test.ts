import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { diaryEntry: { findFirst: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { lastFoodPortion, lastRecipePortion } from "./last-portions";

describe("last portions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the last portion for this user and food", async () => {
    prismaMock.diaryEntry.findFirst.mockResolvedValue({ quantity: new Prisma.Decimal("80.5"), unit: "g" });

    await expect(lastFoodPortion("user-1", "food-1")).resolves.toEqual({ quantity: 80.5, unit: "g" });
    expect(prismaMock.diaryEntry.findFirst).toHaveBeenCalledWith({
      where: { foodId: "food-1", diaryDay: { userId: "user-1" } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { quantity: true, unit: true },
    });
  });

  it("returns no preference without diary history", async () => {
    prismaMock.diaryEntry.findFirst.mockResolvedValue(null);
    await expect(lastFoodPortion("user-1", "food-1")).resolves.toBeNull();
  });

  it("finds both synthetic-food and legacy recipe entries for this user", async () => {
    prismaMock.diaryEntry.findFirst.mockResolvedValue({ quantity: new Prisma.Decimal(2), unit: "serving" });

    await expect(lastRecipePortion("user-1", "recipe-1")).resolves.toEqual({ quantity: 2, unit: "serving" });
    expect(prismaMock.diaryEntry.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        diaryDay: { userId: "user-1" },
        OR: [
          { recipeId: "recipe-1" },
          { food: { ownerId: "user-1", sourceType: "RECIPE", externalProvider: "NUTRICORE_RECIPE", externalId: "recipe-1" } },
        ],
      },
    }));
  });
});
