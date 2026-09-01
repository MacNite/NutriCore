import { Prisma, type MealType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NUTRIENT_KEYS } from "@/lib/nutrients";
import { recipeNutrition, scaleNutrients, type Nutrients } from "@/lib/nutrition";
import { normalizeName, resolvePortion } from "@/lib/units";
import { diaryDate, NotFoundError, PortionError } from "./diary";
import { visibleFoodWhere } from "./foods";

export interface RecipeInput {
  name: string;
  description?: string;
  servings: number;
  yieldWeightG?: number | null;
  instructions?: string;
  tags: string[];
  ingredients: { foodId: string; amount: number; unit: string }[];
}

const foodInclude = {
  nutrients: { select: { nutrientKey: true, value: true } },
  servings: { select: { label: true, unit: true, amount: true, gramEquivalent: true, mlEquivalent: true } },
  sources: { select: { provider: true, metadata: true, retrievedAt: true } },
} as const;

async function resolveIngredients(userId: string, ingredients: RecipeInput["ingredients"], tx: Prisma.TransactionClient = prisma) {
  const foods = await tx.food.findMany({
    where: { id: { in: ingredients.map((item) => item.foodId) }, ...visibleFoodWhere(userId) },
    include: foodInclude,
  });
  const byId = new Map(foods.map((food) => [food.id, food]));
  if (byId.size !== new Set(ingredients.map((item) => item.foodId)).size) throw new NotFoundError("food");

  return ingredients.map((item, position) => {
    const food = byId.get(item.foodId)!;
    const portion = resolvePortion(item.amount, item.unit, {
      basisUnit: food.basisUnit,
      densityGPerMl: food.densityGPerMl ? Number(food.densityGPerMl) : null,
      servings: food.servings.map((serving) => ({
        ...serving,
        amount: Number(serving.amount),
        gramEquivalent: serving.gramEquivalent ? Number(serving.gramEquivalent) : null,
        mlEquivalent: serving.mlEquivalent ? Number(serving.mlEquivalent) : null,
      })),
    });
    if (!portion.ok) throw new PortionError(portion.reason);

    let weightG: number;
    if (portion.unit === "G") weightG = portion.amount;
    else if (food.densityGPerMl && Number(food.densityGPerMl) > 0) weightG = portion.amount * Number(food.densityGPerMl);
    else throw new PortionError("density-required");

    const nutrients: Nutrients = Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, null]));
    for (const nutrient of food.nutrients) nutrients[nutrient.nutrientKey] = nutrient.value === null ? null : Number(nutrient.value);
    return { item, food, portion, weightG, position, nutrients };
  });
}

function calculate(resolved: Awaited<ReturnType<typeof resolveIngredients>>, servings: number, yieldWeightG?: number | null) {
  return recipeNutrition(resolved.map(({ food, portion, weightG, nutrients }) => ({
    nutrients,
    basisAmount: Number(food.basisAmount),
    amount: portion.amount,
    weightG,
  })), servings, yieldWeightG ?? undefined);
}

async function syncRecipeFood(tx: Prisma.TransactionClient, userId: string, recipeId: string, input: RecipeInput, nutrition: ReturnType<typeof calculate>) {
  if (!nutrition.per100g) throw new PortionError("invalid-amount");
  const existing = await tx.food.findFirst({ where: { ownerId: userId, sourceType: "RECIPE", externalProvider: "NUTRICORE_RECIPE", externalId: recipeId } });
  const foodData = {
    ownerId: userId, name: input.name, normalizedName: normalizeName(input.name), locale: null,
    foodType: "RECIPE" as const, sourceType: "RECIPE" as const, externalProvider: "NUTRICORE_RECIPE", externalId: recipeId,
    basisAmount: 100, basisUnit: "G" as const, servingSize: nutrition.portionWeightG,
    servingUnit: "serving", isEstimated: false,
  };
  const food = existing
    ? await tx.food.update({ where: { id: existing.id }, data: foodData })
    : await tx.food.create({ data: foodData });
  await tx.foodNutrient.deleteMany({ where: { foodId: food.id } });
  await tx.foodNutrient.createMany({ data: NUTRIENT_KEYS.map((nutrientKey) => ({ foodId: food.id, nutrientKey, value: nutrition.per100g![nutrientKey] })) });
  await tx.foodServing.deleteMany({ where: { foodId: food.id } });
  await tx.foodServing.create({ data: { foodId: food.id, label: "serving", amount: 1, unit: "serving", gramEquivalent: nutrition.portionWeightG, isDefault: true } });
  await tx.foodSource.deleteMany({ where: { foodId: food.id } });
  await tx.foodSource.create({ data: { foodId: food.id, provider: "NUTRICORE_RECIPE", providerId: recipeId, retrievedAt: new Date(), estimated: false } });
  return food;
}

export async function saveRecipe(userId: string, input: RecipeInput, recipeId?: string) {
  return prisma.$transaction(async (tx) => {
    if (recipeId) {
      const owned = await tx.recipe.findFirst({ where: { id: recipeId, ownerId: userId }, select: { id: true } });
      if (!owned) throw new NotFoundError("recipe");
    }
    const resolved = await resolveIngredients(userId, input.ingredients, tx);
    const nutrition = calculate(resolved, input.servings, input.yieldWeightG);
    const data = {
      name: input.name, description: input.description || null, servings: input.servings,
      yieldWeightG: input.yieldWeightG ?? null, instructions: input.instructions || null, tags: input.tags,
    };
    const recipe = recipeId
      ? await tx.recipe.update({ where: { id: recipeId }, data })
      : await tx.recipe.create({ data: { ...data, ownerId: userId } });
    await tx.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });
    await tx.recipeIngredient.createMany({ data: resolved.map(({ item, portion, weightG, position }) => ({
      recipeId: recipe.id, foodId: item.foodId, amount: item.amount, unit: item.unit,
      normalizedGrams: weightG, normalizedMl: portion.unit === "ML" ? portion.amount : null, position,
    })) });
    const food = await syncRecipeFood(tx, userId, recipe.id, input, nutrition);
    return { recipe, food, nutrition };
  });
}

export async function getRecipe(userId: string, id: string) {
  const recipe = await prisma.recipe.findFirst({
    where: { id, ownerId: userId },
    include: { ingredients: { orderBy: { position: "asc" }, include: { food: { include: foodInclude } } }, sources: true },
  });
  if (!recipe) return null;
  const ingredients = recipe.ingredients.map((ingredient) => ({
    nutrients: Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, ingredient.food.nutrients.find((n) => n.nutrientKey === key)?.value == null ? null : Number(ingredient.food.nutrients.find((n) => n.nutrientKey === key)!.value)])),
    basisAmount: Number(ingredient.food.basisAmount),
    amount: ingredient.normalizedGrams ? (ingredient.food.basisUnit === "G" ? Number(ingredient.normalizedGrams) : Number(ingredient.normalizedMl)) : 0,
    weightG: Number(ingredient.normalizedGrams),
  }));
  return { recipe, nutrition: recipeNutrition(ingredients, Number(recipe.servings), recipe.yieldWeightG ? Number(recipe.yieldWeightG) : undefined) };
}

export async function logRecipe(userId: string, recipeId: string, quantity: number, meal: MealType, date: string) {
  const detail = await getRecipe(userId, recipeId);
  if (!detail) throw new NotFoundError("recipe");
  const { recipe, nutrition } = detail;
  const day = await prisma.diaryDay.upsert({ where: { userId_date: { userId, date: diaryDate(date) } }, create: { userId, date: diaryDate(date) }, update: {} });
  const nutrients = scaleNutrients(nutrition.perServing, 1, quantity);
  return prisma.diaryEntry.create({ data: {
    diaryDayId: day.id, recipeId, meal, label: recipe.name, quantity, unit: "serving",
    normalizedAmount: nutrition.portionWeightG * quantity, normalizedUnit: "G",
    nutritionSnapshot: { nutrients, basisAmount: 1, basisUnit: "SERVING", amount: quantity } as Prisma.InputJsonValue,
    provenanceSnapshot: { sourceType: "RECIPE", provider: "NUTRICORE_RECIPE", externalId: recipe.id, isEstimated: false, loggedAt: new Date().toISOString(), foodName: recipe.name, brand: null } as Prisma.InputJsonValue,
  } });
}

export async function deleteRecipe(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const recipe = await tx.recipe.findFirst({ where: { id, ownerId: userId }, select: { id: true } });
    if (!recipe) throw new NotFoundError("recipe");
    await tx.recipe.delete({ where: { id } });
    await tx.food.deleteMany({ where: { ownerId: userId, sourceType: "RECIPE", externalProvider: "NUTRICORE_RECIPE", externalId: id } });
  });
}
