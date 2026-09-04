/**
 * The nutrient catalogue exists twice: as the TypeScript source of truth in
 * src/lib/nutrients.ts, and as migration SQL so that every deployment gets it.
 * These tests fail if the two ever drift apart, or if a nutrient is added to
 * the code without a migration to carry it into existing databases.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { NUTRIENTS } from "@/lib/nutrients";

const MIGRATIONS = join(process.cwd(), "prisma", "migrations");

/**
 * Every migration that carries catalogue rows, concatenated oldest first.
 *
 * The catalogue grows by shipping a further migration rather than by editing
 * the first one - an applied migration must never change - so a nutrient may
 * be defined by any of them and all of them have to be read together.
 */
function catalogueSql() {
  const dirs = readdirSync(MIGRATIONS)
    .filter((name) => name.includes("_nutrient_catalogue"))
    .sort();
  expect(dirs.length, "a nutrient catalogue migration must exist").toBeGreaterThan(0);
  return dirs.map((dir) => readFileSync(join(MIGRATIONS, dir, "migration.sql"), "utf8")).join("\n");
}

/** Reads the `(id, key, nameDe, nameEn, unit, category, sortOrder)` tuples. */
function parseRows(sql: string) {
  const body = sql
    .split("INSERT INTO")
    .slice(1)
    .map((statement) => statement.slice(statement.indexOf("VALUES"), statement.indexOf("ON CONFLICT")))
    .join("\n");
  return [...body.matchAll(/\(\s*'([^']*)',\s*'([^']*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'([^']*)',\s*'([^']*)',\s*(\d+)\s*\)/g)].map(
    (m) => ({
      id: m[1],
      key: m[2],
      nameDe: m[3].replace(/''/g, "'"),
      nameEn: m[4].replace(/''/g, "'"),
      unit: m[5],
      category: m[6],
      sortOrder: Number(m[7]),
    }),
  );
}

describe("nutrient catalogue migration", () => {
  const rows = parseRows(catalogueSql());

  it("covers exactly the nutrients defined in code", () => {
    expect(rows.map((r) => r.key).sort()).toEqual(NUTRIENTS.map((n) => n.key).sort());
  });

  it("carries the same names, units and ordering as the code", () => {
    for (const nutrient of NUTRIENTS) {
      const row = rows.find((r) => r.key === nutrient.key);
      expect(row, `${nutrient.key} is missing from the migration`).toBeDefined();
      expect(row).toMatchObject({
        nameDe: nutrient.nameDe,
        nameEn: nutrient.nameEn,
        unit: nutrient.unit,
        category: nutrient.category,
        sortOrder: nutrient.sortOrder,
      });
    }
  });

  it("is idempotent, so re-running a migration cannot fail", () => {
    // Every catalogue statement, not merely one of them: a later extension
    // that forgot the upsert would fail on a database that already has the row.
    const statements = catalogueSql().split("INSERT INTO").slice(1);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) expect(statement).toContain('ON CONFLICT ("key") DO UPDATE');
  });

  it("uses deterministic ids rather than a client-side default", () => {
    // NutrientDefinition.id defaults to cuid(), which Prisma generates in the
    // client and is therefore unavailable to raw migration SQL.
    for (const row of rows) expect(row.id).toBe(row.key);
  });
});

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb("nutrient catalogue in the database", () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://unused" } } });

  it("is present after migrations alone, with no seed", async () => {
    const stored = await prisma.nutrientDefinition.findMany({ select: { key: true } });
    expect(stored.map((n) => n.key).sort()).toEqual(NUTRIENTS.map((n) => n.key).sort());
    await prisma.$disconnect();
  });

  it("lets a food be created with nutrients, which is what the FK broke", async () => {
    const stamp = Date.now().toString(36);
    const food = await prisma.food.create({
      data: {
        name: `Catalogue probe ${stamp}`,
        normalizedName: `catalogue probe ${stamp}`,
        foodType: "GENERIC",
        sourceType: "USER",
        basisAmount: 100,
        basisUnit: "G",
        nutrients: { createMany: { data: [{ nutrientKey: "energyKcal", value: 100 }] } },
      },
      include: { nutrients: true },
    });

    expect(food.nutrients).toHaveLength(1);
    await prisma.food.delete({ where: { id: food.id } });
    await prisma.$disconnect();
  });
});
