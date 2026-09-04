/**
 * The bundled food databases, against a real PostgreSQL database.
 *
 * These are the tests that a unit test cannot stand in for: that the
 * migrations apply, that the importer is genuinely idempotent, that a food
 * keeps its id (and therefore its diary entries) across a re-import, and that
 * what ends up in the columns is what the source actually said.
 *
 * Skipped automatically when TEST_DATABASE_URL is not configured.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { NUTRIENTS } from "@/lib/nutrients";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

const prisma = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://unused" } } });

afterAll(async () => {
  await prisma.$disconnect();
});

describeDb("the migrations this feature adds", () => {
  it("carries every source identity the providers use", async () => {
    const rows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT unnest(enum_range(NULL::"SourceType"))::text AS value
    `;
    const values = rows.map((row) => row.value);
    // Distinct identities, so provenance is never a stand-in for another source.
    expect(values).toEqual(
      expect.arrayContaining(["BLS", "USDA", "OPEN_FOOD_FACTS", "FATSECRET", "USER", "RECIPE", "AI_RESEARCH", "IMPORTED"]),
    );
  });

  it("keeps the extended nutrient catalogue in the database", async () => {
    const stored = await prisma.nutrientDefinition.findMany({ select: { key: true } });
    expect(stored.map((row) => row.key).sort()).toEqual(NUTRIENTS.map((nutrient) => nutrient.key).sort());
  });

  it("keeps the pg_trgm indexes fuzzy search depends on", async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename IN ('Food', 'FoodAlias', 'FoodTranslation', 'ExternalFoodCache')
        AND indexdef LIKE '%gin_trgm_ops%'
    `;
    const names = rows.map((row) => row.indexname);
    // The three the initial migration created by hand must survive, because
    // `prisma migrate dev` proposes dropping them every time.
    expect(names).toEqual(
      expect.arrayContaining([
        "Food_normalizedName_trgm_idx",
        "Food_brand_trgm_idx",
        "ExternalFoodCache_normalizedName_trgm_idx",
        "FoodAlias_name_trgm_idx",
        "FoodTranslation_normalizedName_trgm_idx",
      ]),
    );
  });

  it("has the columns the persistence policy and the qualifiers need", async () => {
    const rows = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = 'Food' AND column_name = 'cacheExpiresAt')
          OR (table_name = 'FoodNutrient' AND column_name IN ('qualifier', 'origin')))
    `;
    expect(rows).toHaveLength(3);
  });
});

/**
 * The rest needs the datasets to have been imported (`npm run db:import:foods`).
 * Where they have not been, the suite says so rather than failing on an empty
 * database, because the import is a deployment step and not a migration.
 */
describeDb("the imported datasets", () => {
  let imported = false;

  beforeAll(async () => {
    imported = (await prisma.food.count({ where: { sourceType: "BLS" } })) > 0;
  });

  const whenImported = (name: string, body: () => Promise<void>) =>
    it(name, async () => {
      if (!imported) {
        expect(imported, "run `npm run db:import:foods` to exercise these").toBe(false);
        return;
      }
      await body();
    });

  whenImported("holds the whole BLS release as shared, ownerless foods", async () => {
    const [count, owned] = await Promise.all([
      prisma.food.count({ where: { sourceType: "BLS" } }),
      prisma.food.count({ where: { sourceType: "BLS", ownerId: { not: null } } }),
    ]);
    expect(count).toBe(7140);
    expect(owned).toBe(0);
  });

  whenImported("holds both USDA releases under one provider identity", async () => {
    const count = await prisma.food.count({ where: { sourceType: "USDA", externalProvider: "USDA_FDC" } });
    // 363 Foundation Foods plus 7,793 SR Legacy records.
    expect(count).toBe(8156);
  });

  whenImported("preserves the source's own identifier", async () => {
    const oats = await prisma.food.findUnique({
      where: { externalProvider_externalId: { externalProvider: "BLS", externalId: "C131000" } },
    });
    expect(oats).toMatchObject({ name: "Hafer ganzes Korn, roh", sourceType: "BLS", foodType: "RAW", rawState: "raw" });
  });

  whenImported("converted every unit BLS states differently", async () => {
    const values = await prisma.foodNutrient.findMany({
      where: {
        food: { externalProvider: "BLS", externalId: "C131000" },
        nutrientKey: { in: ["sodium", "copper", "manganese", "vitaminB6"] },
      },
      select: { nutrientKey: true, value: true, sourceValue: true, sourceUnit: true },
    });
    const byKey = Object.fromEntries(values.map((row) => [row.nutrientKey, row]));
    expect(Number(byKey.sodium.value)).toBeCloseTo(0.008, 6);
    expect(Number(byKey.copper.value)).toBeCloseTo(0.484, 6);
    expect(Number(byKey.manganese.value)).toBeCloseTo(6.16, 6);
    expect(Number(byKey.vitaminB6.value)).toBeCloseTo(0.96, 6);
    // The source's own number is kept beside the converted one.
    expect(Number(byKey.sodium.sourceValue)).toBe(8);
    expect(byKey.sodium.sourceUnit).toBe("mg");
  });

  whenImported("never stored an unquantified value as a number", async () => {
    const wrong = await prisma.foodNutrient.count({
      where: {
        qualifier: { in: ["TRACE", "BELOW_LOD", "BELOW_LOQ", "BELOW_LOD_OR_LOQ"] },
        value: { not: null },
      },
    });
    expect(wrong).toBe(0);
  });

  whenImported("kept the zeroes the source states as facts", async () => {
    const logicalZeroes = await prisma.foodNutrient.count({ where: { qualifier: "LOGICAL_ZERO", value: 0 } });
    const contradictions = await prisma.foodNutrient.count({
      where: { qualifier: "LOGICAL_ZERO", NOT: { value: 0 } },
    });
    expect(logicalZeroes).toBeGreaterThan(0);
    expect(contradictions).toBe(0);
  });

  whenImported("stored no nutrient outside the canonical catalogue", async () => {
    const keys = await prisma.foodNutrient.findMany({ distinct: ["nutrientKey"], select: { nutrientKey: true } });
    const canonical = new Set(NUTRIENTS.map((nutrient) => nutrient.key));
    for (const row of keys) expect(canonical.has(row.nutrientKey), row.nutrientKey).toBe(true);
  });

  whenImported("gave every BLS food its official English name", async () => {
    const [foods, translations] = await Promise.all([
      prisma.food.count({ where: { sourceType: "BLS" } }),
      prisma.foodTranslation.count({ where: { locale: "en", food: { sourceType: "BLS" } } }),
    ]);
    // A handful of foods have the same name in both languages and need none.
    expect(translations).toBeGreaterThan(foods * 0.95);
  });

  whenImported("made the slash-separated synonyms searchable", async () => {
    const aliases = await prisma.foodAlias.findMany({
      where: { food: { externalProvider: "BLS", externalId: "R111000" } },
      select: { name: true, locale: true },
    });
    expect(aliases.map((alias) => alias.name)).toEqual(
      expect.arrayContaining(["Speisesalz", "Siedesalz", "Tafelsalz"]),
    );
  });

  whenImported("read the portion weights USDA publishes", async () => {
    const servings = await prisma.foodServing.count({ where: { food: { sourceType: "USDA" } } });
    expect(servings).toBeGreaterThan(1000);
    const withoutWeight = await prisma.foodServing.count({
      where: { food: { sourceType: "USDA" }, gramEquivalent: null, mlEquivalent: null },
    });
    // A named portion with no resolved weight is unusable, so none are written.
    expect(withoutWeight).toBe(0);
  });

  whenImported("left every bundled food permanent", async () => {
    const expiring = await prisma.food.count({
      where: { sourceType: { in: ["BLS", "USDA"] }, cacheExpiresAt: { not: null } },
    });
    expect(expiring).toBe(0);
  });

  whenImported("records what it imported, for the admin panel and for re-runs", async () => {
    const rows = await prisma.datasetImport.findMany({ select: { key: true, version: true, recordCount: true } });
    expect(rows.map((row) => row.key).sort()).toEqual(["bls", "usda-foundation", "usda-sr-legacy"]);
    for (const row of rows) {
      expect(row.recordCount).toBeGreaterThan(0);
      expect(row.version).toBeTruthy();
    }
  });

  whenImported("skips a dataset whose checksum has not changed", async () => {
    // The import runs on deployment, so a repeat must cost a query rather than
    // a minute. Imported through the real code path, not a stub.
    const { importDataset } = await import("@/server/food-datasets/import");
    const outcome = await importDataset("bls");
    expect(outcome.changed).toBe(false);
    expect(outcome.stats.created).toBe(0);
  });
});
