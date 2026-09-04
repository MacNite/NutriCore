import { Prisma, type BasisUnit, type Food, type SourceType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NUTRIENT_KEYS } from "@/lib/nutrients";
import type { Nutrients } from "@/lib/nutrition";
import { normalizeName } from "@/lib/units";
import type { Locale } from "@/i18n/locales";
import { NotFoundError } from "./diary";
import { visibleFoodWhere } from "./foods";
import { getRecipe, saveRecipe } from "./recipes";

/**
 * Sharing a recipe with the other members of this instance.
 *
 * Two rules decide everything in this file.
 *
 * A publication is a **snapshot**, never a readable view of the author's
 * private `Recipe`. Editing the private recipe must not silently rewrite what
 * other members are reading, deleting it must not break what they saved, and
 * publishing must never make the author's private `Food` rows reachable -
 * `visibleFoodWhere` is the whole tenant boundary and a shared `foodId` would
 * hand it away.
 *
 * Saving a publication **copies**, never links. The recipient gets their own
 * recipe, their own foods where they had none, and their own nutrition,
 * calculated by the same `saveRecipe` every manual edit runs. Nothing the
 * author later does can change a meal the recipient has planned.
 */

/** The provider name a food copied out of a publication records as its source. */
export const PUBLICATION_PROVIDER = "NUTRICORE_PUBLICATION";

export interface PublishInput {
  title: string;
  description: string;
  instructions: string;
  tags: string[];
}

/** Nutrition as the publication froze it, so a listing reads no author rows. */
export interface PublicationNutrition {
  perServing: Nutrients;
  per100g: Nutrients | null;
  coverage: Nutrients;
  portionWeightG: number;
  finalWeightG: number;
}

export class PublicationError extends Error {
  constructor(readonly reason: "draft" | "noIngredients" | "nothingToCopy") {
    super(reason);
    this.name = "PublicationError";
  }
}

const decimal = (value: Prisma.Decimal | number | null | undefined) =>
  value === null || value === undefined ? null : Number(value);

/**
 * Publishes, or re-publishes, one of the user's own recipes.
 *
 * Re-publishing updates the existing publication rather than creating a second
 * one, so the recipe keeps one address that members can return to. Copies other
 * members already saved are untouched - they are independent recipes, which is
 * the point of copying rather than linking.
 */
export async function publishRecipe(userId: string, recipeId: string, input: PublishInput) {
  const detail = await getRecipe(userId, recipeId);
  if (!detail) throw new NotFoundError("recipe");
  const { recipe, nutrition } = detail;
  // A draft's numbers have not been reviewed by anyone and it deliberately has
  // no Food entry, which is what stops it being logged. Publishing one would
  // hand unreviewed nutrition to every other member.
  if (recipe.status === "DRAFT") throw new PublicationError("draft");
  if (!recipe.ingredients.length) throw new PublicationError("noIngredients");

  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { displayName: true, language: true } });
  const author = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true } });

  const ingredients = recipe.ingredients.map((item, position) => {
    const food = item.food;
    const nutrients: Nutrients = Object.fromEntries(
      NUTRIENT_KEYS.map((key) => [key, decimal(food.nutrients.find((entry) => entry.nutrientKey === key)?.value)]),
    );
    return {
      position,
      displayName: food.name,
      brand: food.brand,
      amount: Number(item.amount),
      unit: item.unit,
      weightG: Number(item.normalizedGrams),
      normalizedMl: decimal(item.normalizedMl),
      basisAmount: Number(food.basisAmount),
      basisUnit: food.basisUnit,
      nutritionSnapshot: nutrients as Prisma.InputJsonValue,
      sourceType: food.sourceType,
      // A recipe used as an ingredient is the author's own private row. Naming
      // it here would let a recipient link straight back to it, so a nested
      // recipe travels as what it is to everyone else: a food with numbers.
      externalProvider: food.sourceType === "RECIPE" ? null : food.externalProvider,
      externalId: food.sourceType === "RECIPE" ? null : food.externalId,
      barcode: food.barcode,
      densityGPerMl: decimal(food.densityGPerMl),
      // The source's licence, carried with the ingredient. A food a cache-only
      // provider supplied may be re-used while the shared row still exists, but
      // its values are never copied into somebody's permanent private food.
      permanent: food.cacheExpiresAt === null,
    };
  });

  const snapshot: PublicationNutrition = {
    perServing: nutrition.perServing,
    per100g: nutrition.per100g,
    coverage: nutrition.coverage,
    portionWeightG: nutrition.portionWeightG,
    finalWeightG: nutrition.finalWeightG,
  };

  const data = {
    authorNameSnapshot: profile?.displayName ?? author.username,
    title: input.title,
    description: input.description || null,
    servings: recipe.servings,
    yieldWeightG: recipe.yieldWeightG,
    instructions: input.instructions || null,
    tags: input.tags,
    locale: (profile?.language ?? null) as Locale | null,
    nutritionSnapshot: snapshot as unknown as Prisma.InputJsonValue,
    status: "PUBLISHED" as const,
  };

  return prisma.$transaction(async (tx) => {
    const existing = await tx.recipePublication.findFirst({ where: { authorId: userId, sourceRecipeId: recipeId }, select: { id: true } });
    const publication = existing
      ? await tx.recipePublication.update({ where: { id: existing.id }, data: { ...data, publishedAt: new Date() } })
      : await tx.recipePublication.create({ data: { ...data, authorId: userId, sourceRecipeId: recipeId } });
    await tx.recipePublicationIngredient.deleteMany({ where: { publicationId: publication.id } });
    await tx.recipePublicationIngredient.createMany({
      data: ingredients.map((ingredient) => ({ ...ingredient, publicationId: publication.id })),
    });
    return publication;
  });
}

/**
 * Takes a publication out of the listing.
 *
 * Withdrawn rather than deleted: the copies other members saved carry its id as
 * their attribution, and an author changing their mind is not a reason to strip
 * the credit off somebody else's recipe.
 */
export async function withdrawPublication(userId: string, publicationId: string) {
  const publication = await prisma.recipePublication.findFirst({ where: { id: publicationId, authorId: userId }, select: { id: true } });
  if (!publication) throw new NotFoundError("publication");
  return prisma.recipePublication.update({ where: { id: publication.id }, data: { status: "WITHDRAWN" } });
}

/** The publication for one of the user's own recipes, if it has one. */
export async function publicationForRecipe(userId: string, recipeId: string) {
  return prisma.recipePublication.findFirst({
    where: { authorId: userId, sourceRecipeId: recipeId },
    select: { id: true, title: true, status: true, publishedAt: true },
  });
}

export interface FeedCursor {
  publishedAt: Date;
  id: string;
}

/**
 * The instance's shared recipes, newest first.
 *
 * Keyset pagination on `(publishedAt, id)` rather than an offset: a member
 * publishing while somebody is reading page two must not shift a recipe onto a
 * page they have already passed.
 */
export async function listPublications(options: { limit?: number; cursor?: FeedCursor } = {}) {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const cursor = options.cursor;
  const publications = await prisma.recipePublication.findMany({
    where: {
      status: "PUBLISHED",
      ...(cursor
        ? {
            OR: [
              { publishedAt: { lt: cursor.publishedAt } },
              { publishedAt: cursor.publishedAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true, title: true, description: true, tags: true, servings: true,
      authorNameSnapshot: true, publishedAt: true, nutritionSnapshot: true,
      _count: { select: { ingredients: true } },
    },
  });
  const items = publications.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: publications.length > limit && last ? { publishedAt: last.publishedAt, id: last.id } : null,
  };
}

/**
 * One publication, for anybody signed in to this instance.
 *
 * A withdrawn publication is reachable only by its author, and by URL only -
 * hiding it in the listing alone would leave it readable to anyone who kept the
 * link.
 */
export async function getPublication(viewerId: string, publicationId: string) {
  const publication = await prisma.recipePublication.findFirst({
    where: { id: publicationId, OR: [{ status: "PUBLISHED" }, { authorId: viewerId }] },
    include: { ingredients: { orderBy: { position: "asc" } } },
  });
  if (!publication) return null;
  const savedCopy = await prisma.recipe.findFirst({
    where: { ownerId: viewerId, forkedFromPublicationId: publication.id },
    select: { id: true },
  });
  return {
    publication,
    nutrition: publication.nutritionSnapshot as unknown as PublicationNutrition,
    isAuthor: publication.authorId === viewerId,
    savedRecipeId: savedCopy?.id ?? null,
  };
}

/** An ingredient a copy had to leave out, named so the recipient can be told. */
export interface UnsavedIngredient {
  displayName: string;
  reason: "expired-source" | "unmeasurable";
}

type PublicationIngredient = Prisma.RecipePublicationIngredientGetPayload<object>;

/**
 * Finds a food the recipient may legitimately use for this ingredient.
 *
 * The order matters. A shared provider row is preferred, because it is the same
 * food the author used and it keeps its own licence and expiry. Only when there
 * is none does the recipient get a private copy of the snapshot - and never for
 * a cache-only source, whose values must not become permanent by travelling
 * through somebody's recipe.
 */
async function resolveForRecipient(
  tx: Prisma.TransactionClient,
  userId: string,
  ingredient: PublicationIngredient,
  publicationId: string,
): Promise<{ food: Food; created: boolean } | { skipped: UnsavedIngredient["reason"] }> {
  if (ingredient.externalProvider && ingredient.externalId) {
    const shared = await tx.food.findFirst({
      where: { externalProvider: ingredient.externalProvider, externalId: ingredient.externalId, ...visibleFoodWhere(userId) },
    });
    if (shared) return { food: shared, created: false };
  }
  if (ingredient.barcode) {
    const byBarcode = await tx.food.findFirst({ where: { barcode: ingredient.barcode, ...visibleFoodWhere(userId) } });
    if (byBarcode) return { food: byBarcode, created: false };
  }
  // The shared row is gone - pruned once its cache expired - and the snapshot
  // may not be used to recreate it. The recipe is still worth having without
  // this line, so the ingredient is dropped and reported.
  if (!ingredient.permanent) return { skipped: "expired-source" };

  const nutrients = ingredient.nutritionSnapshot as Nutrients;
  const created = await tx.food.create({
    data: {
      ownerId: userId,
      name: ingredient.displayName,
      normalizedName: normalizeName(ingredient.displayName),
      brand: ingredient.brand,
      foodType: "GENERIC",
      // Not the author's `sourceType`: these numbers reached this database by
      // being copied out of a publication, and saying so is the whole point of
      // a source badge.
      sourceType: "IMPORTED" as SourceType,
      basisAmount: ingredient.basisAmount,
      basisUnit: ingredient.basisUnit,
      densityGPerMl: ingredient.densityGPerMl,
      isEstimated: false,
      nutrients: {
        createMany: {
          data: NUTRIENT_KEYS.filter((key) => nutrients[key] != null).map((key) => ({ nutrientKey: key, value: nutrients[key] as number })),
        },
      },
      sources: {
        create: { provider: PUBLICATION_PROVIDER, providerId: publicationId, retrievedAt: new Date(), estimated: false },
      },
    },
  });
  return { food: created, created: true };
}

/**
 * The measure to save this ingredient with, in the resolved food's own basis.
 *
 * The publication's original unit is deliberately not reused. It was resolved
 * against the author's food, and the recipient's may define different named
 * portions or no density at all - so "2 slices" could weigh something else here
 * or fail outright. Saving the resolved weight instead makes the copy's
 * nutrition match the publication the recipient was looking at.
 */
function measureFor(food: { basisUnit: BasisUnit; densityGPerMl: Prisma.Decimal | null }, ingredient: PublicationIngredient) {
  const weightG = Number(ingredient.weightG);
  if (food.basisUnit === "G") return { amount: weightG, unit: "g" };
  const ml = decimal(ingredient.normalizedMl);
  if (ml !== null && ml > 0) return { amount: ml, unit: "ml" };
  // A millilitre food reached through grams needs a density, exactly as it does
  // everywhere else. Without one the ingredient cannot be weighed at all.
  return food.densityGPerMl ? { amount: weightG, unit: "g" } : null;
}

/**
 * Saves a publication as the recipient's own recipe.
 *
 * The copy is independent: its ingredients point at foods the recipient may
 * read, its nutrition is recalculated from those foods by the ordinary
 * `saveRecipe`, and it survives the author editing, withdrawing or deleting
 * anything.
 */
export async function savePublicationAsRecipe(userId: string, publicationId: string) {
  const publication = await prisma.recipePublication.findFirst({
    where: { id: publicationId, OR: [{ status: "PUBLISHED" }, { authorId: userId }] },
    include: { ingredients: { orderBy: { position: "asc" } } },
  });
  if (!publication) throw new NotFoundError("publication");

  // Resolving creates rows, so it is one transaction; the copies it made are
  // removed again below if the recipe itself cannot be saved.
  const { ingredients, unsaved, createdFoodIds } = await prisma.$transaction(async (tx) => {
    const ingredients: { foodId: string; amount: number; unit: string }[] = [];
    const unsaved: UnsavedIngredient[] = [];
    const createdFoodIds: string[] = [];
    for (const ingredient of publication.ingredients) {
      const resolved = await resolveForRecipient(tx, userId, ingredient, publication.id);
      if ("skipped" in resolved) {
        unsaved.push({ displayName: ingredient.displayName, reason: resolved.skipped });
        continue;
      }
      // Only what this save itself created may be cleaned up again. A food the
      // recipient already had - matched by provider id or barcode - is theirs,
      // and deleting it because a later ingredient failed would take a food out
      // of recipes that have nothing to do with this one.
      if (resolved.created) createdFoodIds.push(resolved.food.id);
      const measure = measureFor(resolved.food, ingredient);
      if (!measure) {
        unsaved.push({ displayName: ingredient.displayName, reason: "unmeasurable" });
        continue;
      }
      ingredients.push({ foodId: resolved.food.id, ...measure });
    }
    return { ingredients, unsaved, createdFoodIds };
  });

  // Every ingredient was dropped, so there is no recipe to make - as opposed to
  // a copy that is merely short a line, which is saved and reported.
  if (!ingredients.length) {
    await prisma.food.deleteMany({ where: { id: { in: createdFoodIds }, ownerId: userId } });
    throw new PublicationError("nothingToCopy");
  }

  try {
    const saved = await saveRecipe(
      userId,
      {
        name: publication.title,
        description: publication.description ?? "",
        servings: Number(publication.servings),
        yieldWeightG: decimal(publication.yieldWeightG),
        instructions: publication.instructions ?? "",
        tags: publication.tags,
        ingredients,
      },
      undefined,
      { sourceType: "IMPORTED", forkedFrom: { publicationId: publication.id, authorName: publication.authorNameSnapshot } },
    );
    return { recipe: saved.recipe, unsaved };
  } catch (error) {
    // Nothing else references the foods this save created, and leaving them
    // behind would put ingredients of a recipe that does not exist into the
    // recipient's food list.
    await prisma.food.deleteMany({ where: { id: { in: createdFoodIds }, ownerId: userId } });
    throw error;
  }
}
