"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "./session";
import { deleteRecipe, logRecipe, saveRecipe } from "./recipes";
import { NotFoundError, PortionError } from "./diary";
import type { FormState } from "./profile-actions";

const ingredient = z.object({ foodId: z.string().min(1), amount: z.number().positive().max(100_000), unit: z.string().trim().min(1).max(40) });
const recipeSchema = z.object({
  id: z.string().optional(), name: z.string().trim().min(1).max(200), description: z.string().trim().max(2000),
  servings: z.coerce.number().positive().max(10_000),
  yieldWeightG: z.string().transform((value) => value.trim() === "" ? null : Number(value.replace(",", "."))).refine((value) => value === null || Number.isFinite(value) && value > 0 && value <= 1_000_000),
  instructions: z.string().trim().max(20_000), tags: z.string().transform((value) => [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))].slice(0, 30)),
  ingredients: z.string().transform((value, ctx) => { try { return JSON.parse(value) as unknown; } catch { ctx.addIssue({ code: "custom", message: "invalid" }); return []; } }).pipe(z.array(ingredient).min(1).max(100)),
});

function errorState(error: unknown): FormState {
  if (error instanceof PortionError) return { error: `portion.${error.reason}` };
  if (error instanceof NotFoundError) return { error: "notFound" };
  throw error;
}

export async function saveRecipeAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = recipeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "validation" };
  const { id, ...input } = parsed.data;
  let result;
  try { result = await saveRecipe(user.id, input, id); } catch (error) { return errorState(error); }
  revalidatePath("/recipes"); revalidatePath("/foods");
  redirect(`/recipes/${result.recipe.id}`);
}

const logSchema = z.object({ recipeId: z.string().min(1), quantity: z.coerce.number().positive().max(10_000), meal: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACKS"]), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
export async function logRecipeAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = logSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "validation" };
  try { await logRecipe(user.id, parsed.data.recipeId, parsed.data.quantity, parsed.data.meal, parsed.data.date); } catch (error) { return errorState(error); }
  revalidatePath("/diary"); redirect(`/diary?date=${parsed.data.date}`);
}

export async function deleteRecipeAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z.object({ id: z.string().min(1), confirmation: z.literal("delete") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "validation" };
  try { await deleteRecipe(user.id, parsed.data.id); } catch (error) { return errorState(error); }
  revalidatePath("/recipes"); revalidatePath("/foods"); redirect("/recipes");
}
