import { prisma } from "@/lib/db";

export interface RecentFood {
  id: string;
  name: string;
  brand: string | null;
  sourceType: string;
  /** The amount of the most recent entry, in the unit it was logged with. */
  quantity: number;
  unit: string;
  lastUsedAt: Date;
}

/**
 * How many entries are read to find the most recent distinct foods. Deduplicating
 * in TypeScript rather than with `distinct` keeps `take` from being applied
 * before the duplicates are dropped, and the window is wide enough that a day of
 * repeats does not push the fifth food out of view.
 */
const ENTRY_WINDOW = 20;

/**
 * The foods this user logged last, each with the portion of its latest entry.
 *
 * Read from the diary itself rather than from `FoodUsageStats`, whose counter
 * only ever grows: an entry removed from a meal left the tally saying it was
 * eaten. The diary is the record of what was actually logged, so deleting or
 * editing an entry is reflected here immediately - and the portion it carries
 * is the amount to reach for again, which a count of past uses never was.
 */
export async function recentFoods(userId: string, limit = 5): Promise<RecentFood[]> {
  const entries = await prisma.diaryEntry.findMany({
    where: { diaryDay: { userId }, foodId: { not: null } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit * ENTRY_WINDOW,
    select: {
      quantity: true,
      unit: true,
      createdAt: true,
      food: { select: { id: true, name: true, brand: true, sourceType: true } },
    },
  });

  const recent = new Map<string, RecentFood>();
  for (const entry of entries) {
    // The food behind an entry can have been deleted since it was logged; the
    // entry keeps its snapshot but no longer names anything to log again.
    if (!entry.food || recent.has(entry.food.id)) continue;
    recent.set(entry.food.id, {
      id: entry.food.id,
      name: entry.food.name,
      brand: entry.food.brand,
      sourceType: entry.food.sourceType,
      quantity: Number(entry.quantity),
      unit: entry.unit,
      lastUsedAt: entry.createdAt,
    });
    if (recent.size === limit) break;
  }

  return [...recent.values()];
}
