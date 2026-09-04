import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { diaryEntry: { findMany: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { recentFoods } from "./recent-foods";

const food = (id: string, name: string, brand: string | null = null) => ({
  id,
  name,
  brand,
  sourceType: "OPEN_FOOD_FACTS",
});

const entry = (
  foodRow: ReturnType<typeof food> | null,
  quantity: number,
  unit: string,
  createdAt: string,
) => ({
  quantity: new Prisma.Decimal(quantity),
  unit,
  createdAt: new Date(createdAt),
  food: foodRow,
});

describe("recentFoods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports the portion of the latest entry, not how often a food was logged", async () => {
    const honey = food("honey", "Imker Honig", "Gut & Günstig");
    prismaMock.diaryEntry.findMany.mockResolvedValue([
      entry(honey, 15, "g", "2026-09-04T08:00:00.000Z"),
      entry(honey, 30, "g", "2026-09-03T08:00:00.000Z"),
      entry(honey, 25, "g", "2026-09-02T08:00:00.000Z"),
    ]);

    const recent = await recentFoods("user-1");

    expect(recent).toEqual([
      {
        id: "honey",
        name: "Imker Honig",
        brand: "Gut & Günstig",
        sourceType: "OPEN_FOOD_FACTS",
        quantity: 15,
        unit: "g",
        lastUsedAt: new Date("2026-09-04T08:00:00.000Z"),
      },
    ]);
  });

  it("keeps each food once, in the order it was last logged", async () => {
    prismaMock.diaryEntry.findMany.mockResolvedValue([
      entry(food("fries", "Pommes"), 200, "g", "2026-09-04T18:00:00.000Z"),
      entry(food("milk", "Milch"), 250, "ml", "2026-09-04T07:00:00.000Z"),
      entry(food("fries", "Pommes"), 150, "g", "2026-09-03T18:00:00.000Z"),
    ]);

    const recent = await recentFoods("user-1");

    expect(recent.map((item) => [item.id, item.quantity, item.unit])).toEqual([
      ["fries", 200, "g"],
      ["milk", 250, "ml"],
    ]);
  });

  it("skips an entry whose food has been deleted since", async () => {
    prismaMock.diaryEntry.findMany.mockResolvedValue([
      entry(null, 100, "g", "2026-09-04T18:00:00.000Z"),
      entry(food("egg", "Ei"), 2, "Stück", "2026-09-04T07:00:00.000Z"),
    ]);

    const recent = await recentFoods("user-1");

    expect(recent.map((item) => item.id)).toEqual(["egg"]);
  });

  it("stops at the requested number of foods and reads a wider window to find them", async () => {
    prismaMock.diaryEntry.findMany.mockResolvedValue([
      entry(food("a", "A"), 1, "g", "2026-09-04T12:00:00.000Z"),
      entry(food("b", "B"), 2, "g", "2026-09-04T11:00:00.000Z"),
      entry(food("c", "C"), 3, "g", "2026-09-04T10:00:00.000Z"),
    ]);

    const recent = await recentFoods("user-1", 2);

    expect(recent.map((item) => item.id)).toEqual(["a", "b"]);
    expect(prismaMock.diaryEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { diaryDay: { userId: "user-1" }, foodId: { not: null } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 40,
      }),
    );
  });

  it("reports nothing when the diary holds no logged food", async () => {
    prismaMock.diaryEntry.findMany.mockResolvedValue([]);
    await expect(recentFoods("user-1")).resolves.toEqual([]);
  });
});
