/**
 * Optional development seed: a demo account with a month of demo data.
 *
 * The nutrient catalogue moved to `seed-catalogue.ts`, which is safe to run
 * anywhere. Everything left here creates a real, loginable account, so it is
 * guarded three ways.
 *
 * `SEED_PASSWORD` is required and has no default. It used to fall back to
 * `nutricore-demo-2026`, which is a published credential for an account with a
 * known address, and the fallback was the dangerous half of the seed: the
 * NODE_ENV guard below only helps when NODE_ENV is actually set to production,
 * and it very often is not - an operator troubleshooting from a laptop against
 * a production DATABASE_URL has an empty NODE_ENV and sailed straight past it.
 * A missing password now stops the seed wherever it is run from.
 *
 * The demo account is also created with `mustChangePassword`, so even a seeded
 * instance cannot be used with the password the seeder was given.
 */
import { PrismaClient, type BasisUnit, type FoodType, type SourceType } from "@prisma/client";
import argon2 from "argon2";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "../src/lib/auth";
import { normalizeName } from "../src/lib/units";
import { seedNutrientCatalogue } from "./seed-catalogue";

const prisma = new PrismaClient();

interface SeedFood {
  name: string;
  brand?: string;
  barcode?: string;
  foodType: FoodType;
  sourceType: SourceType;
  basisUnit: BasisUnit;
  servingSize?: number;
  servingUnit?: string;
  densityGPerMl?: number;
  externalProvider?: string;
  externalId?: string;
  rawState?: string;
  nutrients: Record<string, number>;
}

const FOODS: SeedFood[] = [
  {
    name: "Banane, roh",
    foodType: "RAW",
    sourceType: "USDA",
    basisUnit: "G",
    servingSize: 118,
    servingUnit: "g",
    externalProvider: "USDA",
    externalId: "seed-banana",
    rawState: "raw",
    // Per 100 g. Vitamin values deliberately partial so coverage is visible.
    nutrients: {
      energyKcal: 89,
      protein: 1.09,
      carbohydrate: 22.8,
      fat: 0.33,
      sugar: 12.2,
      fiber: 2.6,
      potassium: 358,
      vitaminC: 8.7,
      magnesium: 27,
    },
  },
  {
    name: "Reis, weiß, gekocht",
    foodType: "COOKED",
    sourceType: "USDA",
    basisUnit: "G",
    externalProvider: "USDA",
    externalId: "seed-rice-cooked",
    rawState: "cooked",
    nutrients: { energyKcal: 130, protein: 2.69, carbohydrate: 28.2, fat: 0.28, fiber: 0.4 },
  },
  {
    name: "Reis, weiß, roh",
    foodType: "RAW",
    sourceType: "USDA",
    basisUnit: "G",
    externalProvider: "USDA",
    externalId: "seed-rice-raw",
    // Raw and cooked are separate records: their nutrition differs.
    rawState: "raw",
    nutrients: { energyKcal: 365, protein: 7.13, carbohydrate: 80, fat: 0.66, fiber: 1.3 },
  },
  {
    name: "Hähnchenbrustfilet, roh",
    foodType: "RAW",
    sourceType: "USDA",
    basisUnit: "G",
    externalProvider: "USDA",
    externalId: "seed-chicken-breast",
    rawState: "raw",
    nutrients: { energyKcal: 120, protein: 22.5, carbohydrate: 0, fat: 2.62, sodium: 0.045, salt: 0.113 },
  },
  {
    name: "Skyr Natur",
    brand: "Demo Dairy",
    barcode: "20000001",
    foodType: "PACKAGED",
    sourceType: "OPEN_FOOD_FACTS",
    basisUnit: "G",
    servingSize: 150,
    servingUnit: "g",
    externalProvider: "OPEN_FOOD_FACTS",
    externalId: "20000001",
    nutrients: {
      energyKcal: 63,
      protein: 11,
      carbohydrate: 4,
      fat: 0.2,
      saturatedFat: 0.1,
      sugar: 4,
      salt: 0.1,
      sodium: 0.04,
      calcium: 150,
    },
  },
  {
    name: "Olivenöl nativ extra",
    brand: "Demo Oils",
    foodType: "GENERIC",
    sourceType: "USER",
    basisUnit: "G",
    // A stored density is what makes ml -> g conversion legal for this food.
    densityGPerMl: 0.916,
    nutrients: { energyKcal: 884, protein: 0, carbohydrate: 0, fat: 100, saturatedFat: 13.8, vitaminE: 14.4 },
  },
  {
    name: "Haferflocken",
    foodType: "GENERIC",
    sourceType: "USER",
    basisUnit: "G",
    nutrients: { energyKcal: 372, protein: 13.5, carbohydrate: 58.7, fat: 7, fiber: 10, iron: 4.6, magnesium: 130 },
  },
];

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "yes") {
    throw new Error("Refusing to seed demo data in production. Set SEED_ALLOW_PRODUCTION=yes only if you really mean it.");
  }

  const password = process.env.SEED_PASSWORD;
  if (!password) {
    throw new Error(
      "SEED_PASSWORD is required and has no default. This seed creates a real account; choose a password for it, " +
        "or run `npm run db:seed:catalogue` if all you wanted was the nutrient definitions.",
    );
  }
  // The application's own policy, not a second weaker one beside it: a seeded
  // account is a real account and should not accept a password the sign-up form
  // would refuse.
  const problem = passwordProblem(password);
  if (problem === "too-short") throw new Error(`SEED_PASSWORD must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (problem === "too-common") throw new Error("SEED_PASSWORD is on the common-password list the application rejects.");

  console.warn("\n*** Seeding DEMO DATA: a demo@nutricore.local account and a month of fake diary entries. ***\n");

  console.log(`Seeded ${await seedNutrientCatalogue(prisma)} nutrient definitions`);
  const user = await prisma.user.upsert({
    where: { email: "demo@nutricore.local" },
    create: {
      email: "demo@nutricore.local",
      username: "demo",
      passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      // Even with a chosen password, a seeded account must not stay usable with
      // the credential the seeder was handed.
      mustChangePassword: true,
      profile: {
        create: {
          displayName: "Demo",
          language: "de",
          birthDate: new Date("1992-05-14T00:00:00.000Z"),
          heightCm: 178,
          weightKg: 76.4,
          targetWeightKg: 72,
          biologicalSex: "FEMALE",
          activityLevel: "MODERATE",
          goal: "LOSE",
          onboardedAt: new Date(),
        },
      },
    },
    update: {},
  });

  const foodIds = new Map<string, string>();
  for (const item of FOODS) {
    const isPublic = item.sourceType !== "USER";
    const existing = await prisma.food.findFirst({
      where: item.externalId
        ? { externalProvider: item.externalProvider, externalId: item.externalId }
        : { name: item.name, ownerId: user.id },
    });

    const food = existing
      ? await prisma.food.update({ where: { id: existing.id }, data: { name: item.name } })
      : await prisma.food.create({
          data: {
            ownerId: isPublic ? null : user.id,
            name: item.name,
            normalizedName: normalizeName(item.name),
            brand: item.brand ?? null,
            barcode: item.barcode ?? null,
            locale: "de",
            foodType: item.foodType,
            sourceType: item.sourceType,
            externalProvider: item.externalProvider ?? null,
            externalId: item.externalId ?? null,
            basisAmount: 100,
            basisUnit: item.basisUnit,
            servingSize: item.servingSize ?? null,
            servingUnit: item.servingUnit ?? null,
            densityGPerMl: item.densityGPerMl ?? null,
            rawState: item.rawState ?? null,
            sources: {
              create: {
                provider: item.externalProvider ?? "USER",
                providerId: item.externalId ?? null,
                retrievedAt: new Date(),
                estimated: false,
              },
            },
          },
        });

    await prisma.foodNutrient.deleteMany({ where: { foodId: food.id } });
    await prisma.foodNutrient.createMany({
      data: Object.entries(item.nutrients).map(([nutrientKey, value]) => ({ foodId: food.id, nutrientKey, value })),
      skipDuplicates: true,
    });

    foodIds.set(item.name, food.id);
  }
  console.log(`Seeded ${FOODS.length} foods`);

  const oats = foodIds.get("Haferflocken")!;
  const banana = foodIds.get("Banane, roh")!;
  const chicken = foodIds.get("Hähnchenbrustfilet, roh")!;
  const rice = foodIds.get("Reis, weiß, gekocht")!;

  const recipe = await prisma.recipe.upsert({
    where: { id: "seed-recipe-bowl" },
    create: {
      id: "seed-recipe-bowl",
      ownerId: user.id,
      name: "Hähnchen-Reis-Bowl",
      description: "Einfache Demo-Rezeptur mit bekannter Ausbeute.",
      servings: 2,
      yieldWeightG: 620,
      tags: ["demo", "meal-prep"],
      ingredients: {
        create: [
          { foodId: chicken, amount: 300, unit: "g", normalizedGrams: 300, position: 0 },
          { foodId: rice, amount: 400, unit: "g", normalizedGrams: 400, position: 1 },
        ],
      },
    },
    update: {},
  });
  console.log(`Seeded recipe ${recipe.name}`);

  const today = new Date();
  for (let offset = 0; offset < 3; offset += 1) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
    const day = await prisma.diaryDay.upsert({
      where: { userId_date: { userId: user.id, date } },
      create: { userId: user.id, date },
      update: {},
    });

    if ((await prisma.diaryEntry.count({ where: { diaryDayId: day.id } })) > 0) continue;

    for (const [foodId, meal, grams, label] of [
      [oats, "BREAKFAST", 60, "Haferflocken"],
      [banana, "BREAKFAST", 120, "Banane, roh"],
      [chicken, "LUNCH", 180, "Hähnchenbrustfilet, roh"],
      [rice, "LUNCH", 200, "Reis, weiß, gekocht"],
    ] as const) {
      const nutrients = await prisma.foodNutrient.findMany({ where: { foodId } });
      const scaled = Object.fromEntries(
        nutrients.map((n) => [n.nutrientKey, n.value === null ? null : (Number(n.value) * grams) / 100]),
      );

      await prisma.diaryEntry.create({
        data: {
          diaryDayId: day.id,
          meal,
          foodId,
          label,
          quantity: grams,
          unit: "g",
          normalizedAmount: grams,
          normalizedUnit: "G",
          nutritionSnapshot: { nutrients: scaled, basisAmount: 100, basisUnit: "G", amount: grams },
          provenanceSnapshot: {
            sourceType: "USER",
            provider: "SEED",
            externalId: null,
            isEstimated: false,
            loggedAt: new Date().toISOString(),
            foodName: label,
            brand: null,
          },
        },
      });
    }
  }
  console.log("Seeded diary entries");

  for (let offset = 30; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
    // A gentle downward trend with realistic day-to-day noise.
    const weight = 78 - (30 - offset) * 0.05 + Math.sin(offset) * 0.35;
    await prisma.weightEntry.upsert({
      where: { userId_date: { userId: user.id, date } },
      create: { userId: user.id, date, weightKg: Math.round(weight * 10) / 10 },
      update: {},
    });
  }
  console.log("Seeded 31 weight entries");

  await prisma.favorite.upsert({
    where: { userId_foodId: { userId: user.id, foodId: banana } },
    create: { userId: user.id, foodId: banana },
    update: {},
  });

  console.log("\nDemo account: demo@nutricore.local / the SEED_PASSWORD you supplied");
  console.log("It must change that password on first sign-in.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
