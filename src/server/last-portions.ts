import { prisma } from "@/lib/db";

export interface LastPortion {
  quantity: number;
  unit: string;
}

/** The portion this user most recently logged for one food. */
export async function lastFoodPortion(userId: string, foodId: string): Promise<LastPortion | null> {
  const entry = await prisma.diaryEntry.findFirst({
    where: { foodId, diaryDay: { userId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { quantity: true, unit: true },
  });

  return entry ? { quantity: Number(entry.quantity), unit: entry.unit } : null;
}

/**
 * Recipes are logged through their synthetic Food row. Also accept the legacy
 * direct recipe relation so existing diary history remains a useful default.
 */
export async function lastRecipePortion(userId: string, recipeId: string): Promise<LastPortion | null> {
  const entry = await prisma.diaryEntry.findFirst({
    where: {
      diaryDay: { userId },
      OR: [
        { recipeId },
        {
          food: {
            ownerId: userId,
            sourceType: "RECIPE",
            externalProvider: "NUTRICORE_RECIPE",
            externalId: recipeId,
          },
        },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { quantity: true, unit: true },
  });

  return entry ? { quantity: Number(entry.quantity), unit: entry.unit } : null;
}
