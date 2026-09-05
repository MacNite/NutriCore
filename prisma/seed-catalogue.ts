/**
 * The nutrient catalogue: reference data every deployment needs.
 *
 * Split out of `seed.ts`, which seeded the catalogue and then a demo account
 * with demo diary data in one operation guarded by a single
 * `NODE_ENV === "production"` check. That coupling made the guard actively
 * harmful: refusing to run in production also refused to seed the reference
 * rows a production database legitimately wants, so the only way to get them
 * was to run the demo seed with the guard defeated.
 *
 * This half is idempotent, contains no credentials and no personal data, and is
 * safe to run against any database, production included.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { NUTRIENTS } from "../src/lib/nutrients";

export async function seedNutrientCatalogue(prisma: PrismaClient) {
  for (const nutrient of NUTRIENTS) {
    await prisma.nutrientDefinition.upsert({
      where: { key: nutrient.key },
      create: {
        key: nutrient.key,
        nameDe: nutrient.nameDe,
        nameEn: nutrient.nameEn,
        canonicalUnit: nutrient.unit,
        category: nutrient.category,
        sortOrder: nutrient.sortOrder,
      },
      update: {
        nameDe: nutrient.nameDe,
        nameEn: nutrient.nameEn,
        canonicalUnit: nutrient.unit,
        category: nutrient.category,
        sortOrder: nutrient.sortOrder,
      },
    });
  }
  return NUTRIENTS.length;
}

/** Entry point for `npm run db:seed:catalogue`. */
async function main() {
  const prisma = new PrismaClient();
  try {
    const count = await seedNutrientCatalogue(prisma);
    console.log(`Seeded ${count} nutrient definitions`);
  } finally {
    await prisma.$disconnect();
  }
}

// Only when run directly, so importing `seedNutrientCatalogue` seeds nothing.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
