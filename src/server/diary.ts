import { Prisma, type MealType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolvePortion } from "@/lib/units";
import { scaleNutrients, sumWithCoverage, type Nutrients } from "@/lib/nutrition";
import { getVisibleFood } from "./foods";
import { NUTRIENT_KEYS } from "@/lib/nutrients";

export const MEALS: MealType[] = ["BREAKFAST", "LUNCH", "DINNER", "SNACKS"];

/** A date-only key in UTC, so a diary day never shifts with the server timezone. */
export function diaryDate(input: string | Date): Date {
  const date = typeof input === "string" ? new Date(`${input}T00:00:00.000Z`) : input;
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid date");
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export const formatDateKey = (date: Date) => date.toISOString().slice(0, 10);

export interface EntrySnapshot {
  nutrients: Nutrients;
  basisAmount: number;
  basisUnit: string;
  amount: number;
}

export interface ProvenanceSnapshot {
  sourceType: string;
  provider: string | null;
  externalId: string | null;
  isEstimated: boolean;
  loggedAt: string;
  foodName: string;
  brand: string | null;
}

export class PortionError extends Error {
  constructor(public readonly reason: string) {
    super(`Cannot resolve portion: ${reason}`);
    this.name = "PortionError";
  }
}

export interface AddEntryInput {
  userId: string;
  date: string;
  meal: MealType;
  foodId: string;
  quantity: number;
  unit: string;
}

/**
 * Logs a food and freezes its nutrition into the entry. A later provider update
 * changes the food record but can never rewrite this entry.
 */
export async function addDiaryEntry(input: AddEntryInput) {
  const food = await getVisibleFood(input.userId, input.foodId);
  if (!food) throw new NotFoundError("food");

  const portion = resolvePortion(input.quantity, input.unit, {
    basisUnit: food.basisUnit,
    densityGPerMl: food.densityGPerMl,
    servings: food.servings,
  });
  if (!portion.ok) throw new PortionError(portion.reason);

  const scaled = scaleNutrients(food.nutrients, food.basisAmount, portion.amount);

  const source = await prisma.foodSource.findFirst({
    where: { foodId: food.id },
    orderBy: { retrievedAt: "desc" },
  });

  const day = await prisma.diaryDay.upsert({
    where: { userId_date: { userId: input.userId, date: diaryDate(input.date) } },
    create: { userId: input.userId, date: diaryDate(input.date) },
    update: {},
  });

  const snapshot: EntrySnapshot = {
    nutrients: scaled,
    basisAmount: food.basisAmount,
    basisUnit: food.basisUnit,
    amount: portion.amount,
  };

  const provenance: ProvenanceSnapshot = {
    sourceType: food.sourceType,
    provider: source?.provider ?? null,
    externalId: source?.providerId ?? null,
    isEstimated: food.isEstimated,
    loggedAt: new Date().toISOString(),
    foodName: food.name,
    brand: food.brand,
  };

  const entry = await prisma.diaryEntry.create({
    data: {
      diaryDayId: day.id,
      meal: input.meal,
      foodId: food.id,
      label: food.name,
      quantity: input.quantity,
      unit: input.unit,
      normalizedAmount: portion.amount,
      normalizedUnit: portion.unit,
      nutritionSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      provenanceSnapshot: provenance as unknown as Prisma.InputJsonValue,
    },
  });

  await recordUsage(input.userId, food.id, input.meal);
  return entry;
}

/** Usage metadata that lets ranking improve over time without any ML. */
async function recordUsage(userId: string, foodId: string, meal: MealType) {
  const existing = await prisma.foodUsageStats.findUnique({ where: { userId_foodId: { userId, foodId } } });
  const usualMeals = new Set(existing?.usualMeals ?? []);
  usualMeals.add(meal);

  await prisma.foodUsageStats.upsert({
    where: { userId_foodId: { userId, foodId } },
    create: { userId, foodId, count: 1, lastUsedAt: new Date(), usualMeals: [meal] },
    update: { count: { increment: 1 }, lastUsedAt: new Date(), usualMeals: [...usualMeals] },
  });
}

export class NotFoundError extends Error {
  constructor(public readonly entity: string) {
    super(`${entity} not found`);
    this.name = "NotFoundError";
  }
}

/** Every mutation goes through an ownership check before touching a row. */
async function ownedEntry(userId: string, entryId: string) {
  const entry = await prisma.diaryEntry.findFirst({
    where: { id: entryId, diaryDay: { userId } },
    include: { diaryDay: true },
  });
  if (!entry) throw new NotFoundError("entry");
  return entry;
}

export async function updateDiaryEntry(userId: string, entryId: string, changes: { quantity?: number; unit?: string; meal?: MealType }) {
  const entry = await ownedEntry(userId, entryId);

  if (changes.meal && changes.quantity === undefined && !changes.unit) {
    return prisma.diaryEntry.update({ where: { id: entry.id }, data: { meal: changes.meal } });
  }

  if (!entry.foodId) throw new NotFoundError("food");
  const food = await getVisibleFood(userId, entry.foodId);
  if (!food) throw new NotFoundError("food");

  const quantity = changes.quantity ?? Number(entry.quantity);
  const unit = changes.unit ?? entry.unit;
  const portion = resolvePortion(quantity, unit, {
    basisUnit: food.basisUnit,
    densityGPerMl: food.densityGPerMl,
    servings: food.servings,
  });
  if (!portion.ok) throw new PortionError(portion.reason);

  // Re-scale from the entry's own frozen per-basis values, so editing an amount
  // never silently pulls in newer provider data.
  const original = entry.nutritionSnapshot as unknown as EntrySnapshot;
  const perBasis = scaleNutrients(original.nutrients, original.amount, original.basisAmount);
  const rescaled = scaleNutrients(perBasis, original.basisAmount, portion.amount);

  return prisma.diaryEntry.update({
    where: { id: entry.id },
    data: {
      quantity,
      unit,
      meal: changes.meal ?? entry.meal,
      normalizedAmount: portion.amount,
      normalizedUnit: portion.unit,
      nutritionSnapshot: {
        ...original,
        nutrients: rescaled,
        amount: portion.amount,
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function deleteDiaryEntry(userId: string, entryId: string) {
  const entry = await ownedEntry(userId, entryId);
  await prisma.diaryEntry.delete({ where: { id: entry.id } });
}

export async function copyDiaryEntry(userId: string, entryId: string, target: { date: string; meal: MealType }) {
  const entry = await ownedEntry(userId, entryId);
  const day = await prisma.diaryDay.upsert({
    where: { userId_date: { userId, date: diaryDate(target.date) } },
    create: { userId, date: diaryDate(target.date) },
    update: {},
  });

  return prisma.diaryEntry.create({
    data: {
      diaryDayId: day.id,
      meal: target.meal,
      foodId: entry.foodId,
      recipeId: entry.recipeId,
      label: entry.label,
      quantity: entry.quantity,
      unit: entry.unit,
      normalizedAmount: entry.normalizedAmount,
      normalizedUnit: entry.normalizedUnit,
      // The copy carries the original snapshot, staying a faithful duplicate.
      nutritionSnapshot: entry.nutritionSnapshot as Prisma.InputJsonValue,
      provenanceSnapshot: entry.provenanceSnapshot as Prisma.InputJsonValue,
    },
  });
}

export async function copyMeal(userId: string, from: { date: string; meal: MealType }, to: { date: string; meal: MealType }) {
  const source = await prisma.diaryDay.findUnique({
    where: { userId_date: { userId, date: diaryDate(from.date) } },
    include: { entries: { where: { meal: from.meal } } },
  });
  if (!source || source.entries.length === 0) return 0;

  const day = await prisma.diaryDay.upsert({
    where: { userId_date: { userId, date: diaryDate(to.date) } },
    create: { userId, date: diaryDate(to.date) },
    update: {},
  });

  await prisma.diaryEntry.createMany({
    data: source.entries.map((entry) => ({
      diaryDayId: day.id,
      meal: to.meal,
      foodId: entry.foodId,
      recipeId: entry.recipeId,
      label: entry.label,
      quantity: entry.quantity,
      unit: entry.unit,
      normalizedAmount: entry.normalizedAmount,
      normalizedUnit: entry.normalizedUnit,
      nutritionSnapshot: entry.nutritionSnapshot as Prisma.InputJsonValue,
      provenanceSnapshot: entry.provenanceSnapshot as Prisma.InputJsonValue,
    })),
  });

  return source.entries.length;
}

export interface DiaryDayView {
  date: string;
  meals: {
    meal: MealType;
    entries: {
      id: string;
      /** Set when the entry came from a food, so its row can lead to that food. */
      foodId: string | null;
      /** Same for a recipe: the row leads to the recipe it was logged from. */
      recipeId: string | null;
      label: string;
      brand: string | null;
      quantity: number;
      unit: string;
      normalizedAmount: number | null;
      normalizedUnit: string | null;
      sourceType: string;
      isEstimated: boolean;
      nutrients: Nutrients;
    }[];
    totals: Nutrients;
  }[];
  totals: Nutrients;
  /** Sums of the available values, even when some entries lack that nutrient. */
  knownTotals: Nutrients;
  coverage: Record<string, number | null>;
}

export async function getDiaryDay(userId: string, date: string): Promise<DiaryDayView> {
  const day = await prisma.diaryDay.findUnique({
    where: { userId_date: { userId, date: diaryDate(date) } },
    include: { entries: { orderBy: { createdAt: "asc" } } },
  });

  const entries = (day?.entries ?? []).map((entry) => {
    const snapshot = entry.nutritionSnapshot as unknown as EntrySnapshot;
    const provenance = entry.provenanceSnapshot as unknown as ProvenanceSnapshot;
    return {
      id: entry.id,
      meal: entry.meal,
      foodId: entry.foodId,
      recipeId: entry.recipeId,
      label: entry.label,
      brand: provenance?.brand ?? null,
      quantity: Number(entry.quantity),
      unit: entry.unit,
      normalizedAmount: entry.normalizedAmount ? Number(entry.normalizedAmount) : null,
      normalizedUnit: entry.normalizedUnit,
      sourceType: provenance?.sourceType ?? "USER",
      isEstimated: provenance?.isEstimated ?? false,
      nutrients: snapshot?.nutrients ?? {},
      amount: snapshot?.amount ?? 0,
    };
  });

  const meals = MEALS.map((meal) => {
    const mealEntries = entries.filter((entry) => entry.meal === meal);
    const { total } = sumWithCoverage(
      mealEntries.map((e) => ({ amount: e.amount, nutrients: e.nutrients })),
      NUTRIENT_KEYS,
    );
    return { meal, entries: mealEntries, totals: total };
  });

  const { known, total, coverage } = sumWithCoverage(
    entries.map((e) => ({ amount: e.amount, nutrients: e.nutrients })),
    NUTRIENT_KEYS,
  );

  return { date, meals, totals: total, knownTotals: known, coverage };
}
