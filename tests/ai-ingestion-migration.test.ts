/**
 * Replays the migration history against a real, populated database.
 *
 * `20260903000000_unify_ai_ingestion` copies "MealInput" and "RecipeImport"
 * into one "AiIngestionInput" table under prefixed ids, and then puts a foreign
 * key on the column that points at it. Applying that to an empty database - all
 * CI ever did - proves nothing about the rows a running installation holds: the
 * migration failed in production on an `AiJob` whose link it had not re-keyed,
 * and a failed migration blocks every later one, so the app and the worker
 * restarted for ever.
 *
 * These tests therefore seed the shape a real database has at the point the
 * migration runs, including the rows written by versions that have since been
 * replaced, and assert the migration survives it.
 *
 * Skipped automatically when TEST_DATABASE_URL is not configured.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

const UNIFY = "20260903000000_unify_ai_ingestion";
const MIGRATIONS = join(process.cwd(), "prisma", "migrations");
const PRISMA_CLI = join(process.cwd(), "node_modules", "prisma", "build", "index.js");

/** A datasource-only schema: the migrations are the subject, not the client. */
const SCHEMA = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}
`;

/** Migration directory names in the order Prisma applies them. */
function migrationNames() {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describeDb("ai ingestion migration against a populated database", () => {
  const admin = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://unused" } } });
  const database = `nutricore_migration_${Date.now().toString(36)}`;
  let workspace: string;
  let scratchUrl: string;
  let scratch: PrismaClient;

  /** Applies every migration whose name is `<= upTo`, through the Prisma CLI. */
  function deploy(upTo: string) {
    const target = join(workspace, "prisma", "migrations");
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    cpSync(join(MIGRATIONS, "migration_lock.toml"), join(target, "migration_lock.toml"));
    for (const name of migrationNames().filter((name) => name <= upTo)) {
      cpSync(join(MIGRATIONS, name), join(target, name), { recursive: true });
    }
    execFileSync(process.execPath, [PRISMA_CLI, "migrate", "deploy", "--schema", join(workspace, "prisma", "schema.prisma")], {
      env: { ...process.env, DATABASE_URL: scratchUrl },
      stdio: "pipe",
    });
  }

  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), "nutricore-migration-"));
    mkdirSync(join(workspace, "prisma"), { recursive: true });
    writeFileSync(join(workspace, "prisma", "schema.prisma"), SCHEMA);

    // A scratch database on the same server, so the suite's own database keeps
    // the schema every other test expects.
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    const target = new URL(url!);
    target.pathname = `/${database}`;
    scratchUrl = target.toString();
    scratch = new PrismaClient({ datasources: { db: { url: scratchUrl } } });

    // The state a deployment is in just before the unification: everything up
    // to, but not including, the migration under test.
    const previous = migrationNames().filter((name) => name < UNIFY).at(-1)!;
    deploy(previous);

    // Rows a real installation holds at that point. `RECIPE_LOG` is the one
    // that mattered: "log a stored recipe to the diary" created a "MealInput"
    // of its own and linked it through the same column as a quick meal, so a
    // migration that re-keys only quick meals leaves it dangling.
    await scratch.$executeRawUnsafe(
      `INSERT INTO "User" ("id","email","username","passwordHash","updatedAt")
       VALUES ('u1','probe@test.local','probe','x',now())`,
    );
    await scratch.$executeRawUnsafe(
      `INSERT INTO "MealInput" ("id","userId","text","meal","diaryDate","servings")
       VALUES ('quick','u1','two eggs','BREAKFAST','2026-09-01',1),
              ('logged','u1','Lasagne','DINNER','2026-09-01',1)`,
    );
    await scratch.$executeRawUnsafe(
      `INSERT INTO "RecipeImport" ("id","userId","text","sourceUrl","servings")
       VALUES ('import','u1','lasagne','https://recipes.example/lasagne',4)`,
    );
    await scratch.$executeRawUnsafe(
      `INSERT INTO "AiJob" ("id","userId","entityType","entityId","mealInputId","status","priority","metadata") VALUES
         ('quick-job','u1','MEAL_INPUT','quick','quick','COMPLETED',10,'{"addToMeal":true,"createRecipe":true}'),
         ('log-job','u1','RECIPE_LOG','logged','logged','COMPLETED',10,'{"recipeId":"r1","servings":1}'),
         ('import-job','u1','RECIPE_IMPORT','import',NULL,'RUNNING',10,NULL),
         -- An import that is no longer there. "entityId" never had a foreign
         -- key, so no upgrade may depend on it resolving.
         ('stale-job','u1','RECIPE_IMPORT','gone',NULL,'FAILED',10,NULL)`,
    );

    deploy(UNIFY);
  }, 120_000);

  afterAll(async () => {
    await scratch?.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.$disconnect();
    rmSync(workspace, { recursive: true, force: true });
  });

  it("copies both input tables under prefixed ids", async () => {
    const inputs = await scratch.aiIngestionInput.findMany({ select: { id: true, intent: true }, orderBy: { id: "asc" } });
    expect(inputs).toEqual([
      { id: "meal_logged", intent: "MEAL" },
      // "Rezept anlegen" was ticked, so the input is a recipe run.
      { id: "meal_quick", intent: "RECIPE" },
      { id: "recipe_import", intent: "RECIPE" },
    ]);
  });

  it("carries a legacy recipe-log job's link over with its input", async () => {
    const job = await scratch.aiJob.findUniqueOrThrow({ where: { id: "log-job" } });
    // Still its own kind of work - the worker branches on the name - but now
    // pointing at the copied input, which that branch requires.
    expect(job.entityType).toBe("RECIPE_LOG");
    expect(job.ingestionInputId).toBe("meal_logged");
    expect(job.entityId).toBe("meal_logged");
  });

  it("re-keys both ingestion entry points onto the unified type", async () => {
    const quick = await scratch.aiJob.findUniqueOrThrow({ where: { id: "quick-job" } });
    expect(quick).toMatchObject({ entityType: "AI_INGESTION", entityId: "meal_quick", ingestionInputId: "meal_quick" });

    const imported = await scratch.aiJob.findUniqueOrThrow({ where: { id: "import-job" } });
    expect(imported).toMatchObject({ entityType: "AI_INGESTION", entityId: "recipe_import", ingestionInputId: "recipe_import" });
    // A row a removed worker was holding is requeued rather than left RUNNING.
    expect(imported.status).toBe("QUEUED");
  });

  it("drops a link that cannot resolve instead of failing the upgrade", async () => {
    const stale = await scratch.aiJob.findUniqueOrThrow({ where: { id: "stale-job" } });
    expect(stale.ingestionInputId).toBeNull();
  });
});
