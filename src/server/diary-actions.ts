"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { MealType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "./session";
import {
  NotFoundError,
  PortionError,
  addDiaryEntry,
  copyDiaryEntry,
  copyMeal,
  deleteDiaryEntry,
  formatDateKey,
  updateDiaryEntry,
} from "./diary";
import type { FormState } from "./profile-actions";

const MEAL = z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACKS"]);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const addSchema = z.object({
  foodId: z.string().min(1),
  date: DATE,
  meal: MEAL,
  quantity: z.coerce.number().positive().max(100_000),
  unit: z.string().trim().min(1).max(40),
});

function refresh() {
  revalidatePath("/");
}

/** Maps a domain failure onto a translatable key without leaking internals. */
function toState(error: unknown): FormState {
  if (error instanceof PortionError) return { error: `portion.${error.reason}` };
  if (error instanceof NotFoundError) return { error: "notFound" };
  throw error;
}

export async function addEntryAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = addSchema.safeParse({
    foodId: formData.get("foodId"),
    date: formData.get("date"),
    meal: formData.get("meal"),
    quantity: formData.get("quantity"),
    unit: formData.get("unit"),
  });
  if (!parsed.success) return { error: "validation" };

  try {
    await addDiaryEntry({ userId: user.id, ...parsed.data });
  } catch (error) {
    return toState(error);
  }

  refresh();
  const returnMeal = MEAL.safeParse(formData.get("returnToMeal"));
  if (returnMeal.success) redirect(`/?date=${parsed.data.date}&editMeal=${returnMeal.data}`);
  redirect(`/foods?meal=${parsed.data.meal}&date=${parsed.data.date}`);
}

const updateSchema = z.object({
  entryId: z.string().min(1),
  date: DATE,
  quantity: z.coerce.number().positive().max(100_000).optional(),
  unit: z.string().trim().min(1).max(40).optional(),
  meal: MEAL.optional(),
});

export async function updateEntryAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = updateSchema.safeParse({
    entryId: formData.get("entryId"),
    date: formData.get("date"),
    quantity: formData.get("quantity") || undefined,
    unit: formData.get("unit") || undefined,
    meal: formData.get("meal") || undefined,
  });
  if (!parsed.success) return { error: "validation" };

  try {
    await updateDiaryEntry(user.id, parsed.data.entryId, parsed.data);
  } catch (error) {
    return toState(error);
  }

  refresh();
  return { ok: true };
}

export async function deleteEntryAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const entryId = String(formData.get("entryId") ?? "");
  if (!entryId) return { error: "validation" };

  try {
    await deleteDiaryEntry(user.id, entryId);
  } catch (error) {
    return toState(error);
  }

  refresh();
  return { ok: true };
}

export async function copyEntryAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({ entryId: z.string().min(1), date: DATE, meal: MEAL })
    .safeParse({ entryId: formData.get("entryId"), date: formData.get("date"), meal: formData.get("meal") });
  if (!parsed.success) return { error: "validation" };

  try {
    await copyDiaryEntry(user.id, parsed.data.entryId, { date: parsed.data.date, meal: parsed.data.meal });
  } catch (error) {
    return toState(error);
  }

  refresh();
  return { ok: true };
}

export async function copyPreviousDayAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z.object({ date: DATE }).safeParse({ date: formData.get("date") });
  if (!parsed.success) return { error: "validation" };

  const target = new Date(`${parsed.data.date}T00:00:00.000Z`);
  const previous = formatDateKey(new Date(target.getTime() - 86_400_000));

  let copied = 0;
  for (const meal of ["BREAKFAST", "LUNCH", "DINNER", "SNACKS"] as MealType[]) {
    copied += await copyMeal(user.id, { date: previous, meal }, { date: parsed.data.date, meal });
  }

  refresh();
  return copied > 0 ? { ok: true } : { error: "nothingToCopy" };
}

export async function toggleFavoriteAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const foodId = String(formData.get("foodId") ?? "");
  if (!foodId) return { error: "validation" };

  // Confirm the food is visible to this user before creating a reference to it.
  const food = await prisma.food.findFirst({
    where: { id: foodId, OR: [{ ownerId: null }, { ownerId: user.id }] },
    select: { id: true },
  });
  if (!food) return { error: "notFound" };

  const existing = await prisma.favorite.findUnique({ where: { userId_foodId: { userId: user.id, foodId } } });
  if (existing) await prisma.favorite.delete({ where: { userId_foodId: { userId: user.id, foodId } } });
  else await prisma.favorite.create({ data: { userId: user.id, foodId } });

  revalidatePath("/");
  revalidatePath("/foods");
  return { ok: true };
}
