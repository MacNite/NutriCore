CREATE TABLE "AiIngestionInput" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "intent" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "imageMime" TEXT,
  "imageData" BYTEA,
  "imageExpiresAt" TIMESTAMP(3),
  "meal" "MealType",
  "diaryDate" DATE,
  "servings" DECIMAL(8,2) NOT NULL DEFAULT 1,
  "logAfterConfirm" BOOLEAN NOT NULL DEFAULT false,
  "draft" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiIngestionInput_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AiIngestionInput" ("id", "userId", "intent", "text", "sourceUrl", "imageMime", "imageData", "imageExpiresAt", "meal", "diaryDate", "servings", "createdAt")
SELECT 'meal_' || "id", "userId", 'MEAL', "text", "sourceUrl", "imageMime", "imageData", "imageExpiresAt", "meal", "diaryDate", "servings", "createdAt" FROM "MealInput";

INSERT INTO "AiIngestionInput" ("id", "userId", "intent", "text", "sourceUrl", "imageMime", "imageData", "imageExpiresAt", "servings", "draft", "createdAt")
SELECT 'recipe_' || "id", "userId", 'RECIPE', COALESCE("text", ''), "sourceUrl", "imageMime", "imageData", CASE WHEN "imageData" IS NULL THEN NULL ELSE "createdAt" + INTERVAL '24 hours' END, "servings", "draft", "createdAt" FROM "RecipeImport";

-- Historical checkbox flags are promoted into the input before job metadata becomes legacy-only.
-- Read as text rather than cast to boolean: `metadata` is free-form JSON, and a
-- value that is not spelled exactly `true`/`false` would abort the whole
-- migration on the cast instead of falling back to the documented default.
UPDATE "AiIngestionInput" input SET "intent" = 'RECIPE', "logAfterConfirm" = (job."metadata"->>'addToMeal') IS DISTINCT FROM 'false'
FROM "AiJob" job WHERE job."entityType" = 'MEAL_INPUT' AND input."id" = 'meal_' || job."entityId" AND job."metadata"->>'createRecipe' = 'true';

ALTER TABLE "AiJob" DROP CONSTRAINT "AiJob_mealInputId_fkey";
ALTER TABLE "Recipe" DROP CONSTRAINT "Recipe_importId_fkey";

-- Every job that points at a "MealInput" follows it to its copy, not only the
-- quick meals. A "RECIPE_LOG" job - logging a stored recipe to the diary, queued
-- by a version that has since been replaced - created a "MealInput" of its own
-- and linked it through the very same column, and the worker still expects that
-- link to be there. Re-keying only 'MEAL_INPUT' rows left those ids untouched,
-- which is what made this migration fail on the foreign key below.
UPDATE "AiJob" SET "entityId" = 'meal_' || "entityId", "mealInputId" = 'meal_' || COALESCE("mealInputId", "entityId")
WHERE "entityType" IN ('MEAL_INPUT', 'RECIPE_LOG');
-- Only the two ingestion entry points become the unified type; a recipe log is
-- still its own kind of work, and the worker branches on it by name.
UPDATE "AiJob" SET "entityType" = 'AI_INGESTION' WHERE "entityType" = 'MEAL_INPUT';
UPDATE "AiJob" SET "entityId" = 'recipe_' || "entityId", "mealInputId" = 'recipe_' || "entityId", "entityType" = 'AI_INGESTION'
WHERE "entityType" = 'RECIPE_IMPORT';
UPDATE "Recipe" SET "importId" = 'recipe_' || "importId" WHERE "importId" IS NOT NULL;

-- The links above are partly derived from "AiJob"."entityId", which no foreign
-- key ever covered, so a row pointing at an input that is not there is possible
-- and must not be allowed to stop an upgrade. Both columns are nullable and
-- every reader already copes with a job or a recipe whose input has gone.
UPDATE "AiJob" job SET "mealInputId" = NULL
WHERE job."mealInputId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AiIngestionInput" input WHERE input."id" = job."mealInputId");
UPDATE "Recipe" recipe SET "importId" = NULL
WHERE recipe."importId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AiIngestionInput" input WHERE input."id" = recipe."importId");

-- A RUNNING row may have been held by a worker using the removed tables. Requeueing
-- it makes the new worker resume deterministically from the copied input and cached metadata.
UPDATE "AiJob" SET "status" = 'QUEUED', "startedAt" = NULL
WHERE "entityType" = 'AI_INGESTION' AND "status" = 'RUNNING';

ALTER TABLE "AiJob" RENAME COLUMN "mealInputId" TO "ingestionInputId";
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_ingestionInputId_fkey" FOREIGN KEY ("ingestionInputId") REFERENCES "AiIngestionInput"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_importId_fkey" FOREIGN KEY ("importId") REFERENCES "AiIngestionInput"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiIngestionInput" ADD CONSTRAINT "AiIngestionInput_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "AiIngestionInput_userId_createdAt_idx" ON "AiIngestionInput"("userId", "createdAt");
CREATE INDEX "AiIngestionInput_imageExpiresAt_idx" ON "AiIngestionInput"("imageExpiresAt");
DROP TABLE "MealInput";
DROP TABLE "RecipeImport";
