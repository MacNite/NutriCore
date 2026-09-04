"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { NotFoundError, PortionError } from "./diary";
import { PublicationError, publishRecipe, savePublicationAsRecipe, withdrawPublication } from "./recipe-publications";
import { requireUser } from "./session";
import type { FormState } from "./profile-actions";

/**
 * Every entry point into recipe sharing. As everywhere else, the session is
 * resolved and the tenant authorised here, before a service is called: the
 * services themselves take a user id and trust it.
 */

function errorState(error: unknown): FormState {
  if (error instanceof PublicationError) return { error: `publication.${error.reason}` };
  if (error instanceof PortionError) return { error: `portion.${error.reason}` };
  if (error instanceof NotFoundError) return { error: "notFound" };
  throw error;
}

const publishSchema = z.object({
  recipeId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000),
  instructions: z.string().trim().max(20_000),
  tags: z
    .string()
    .transform((value) => [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))].slice(0, 30)),
  /** Typed by the author, so publishing is never a stray click on a card. */
  confirmation: z.literal("publish"),
});

export async function publishRecipeAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const limit = rateLimit(`publish:${user.id}`, RATE_LIMITS.publish.limit, RATE_LIMITS.publish.windowMs);
  if (!limit.allowed) return { error: "rateLimited" };

  const parsed = publishSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "validation" };
  const { recipeId, title, description, instructions, tags } = parsed.data;

  let publication;
  try {
    publication = await publishRecipe(user.id, recipeId, { title, description, instructions, tags });
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/recipes/shared");
  revalidatePath(`/recipes/${recipeId}`);
  redirect(`/recipes/shared/${publication.id}`);
}

export async function withdrawPublicationAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z.object({ id: z.string().min(1), recipeId: z.string().optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "validation" };
  try {
    await withdrawPublication(user.id, parsed.data.id);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/recipes/shared");
  if (parsed.data.recipeId) revalidatePath(`/recipes/${parsed.data.recipeId}`);
  redirect("/recipes/shared");
}

/**
 * Saves a shared recipe as the recipient's own.
 *
 * The copy may legitimately be short an ingredient - a food from a cache-only
 * source whose shared row has since been pruned cannot be recreated - so the
 * result says which, on the recipe that was created rather than as an error
 * that loses the rest of it.
 */
export async function savePublicationAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z.object({ id: z.string().min(1) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "validation" };

  let saved;
  try {
    saved = await savePublicationAsRecipe(user.id, parsed.data.id);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/foods");
  revalidatePath(`/recipes/shared/${parsed.data.id}`);
  const unsaved = saved.unsaved.map((item) => item.displayName).join(", ");
  redirect(`/recipes/${saved.recipe.id}${unsaved ? `?unsaved=${encodeURIComponent(unsaved)}` : ""}`);
}
