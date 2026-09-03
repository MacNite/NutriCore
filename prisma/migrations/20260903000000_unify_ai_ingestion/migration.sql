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
UPDATE "AiIngestionInput" input SET "intent" = 'RECIPE', "logAfterConfirm" = COALESCE((job."metadata"->>'addToMeal')::boolean, true)
FROM "AiJob" job WHERE job."entityType" = 'MEAL_INPUT' AND job."entityId" = substring(input."id" from 6) AND COALESCE((job."metadata"->>'createRecipe')::boolean, false);

ALTER TABLE "AiJob" DROP CONSTRAINT "AiJob_mealInputId_fkey";
ALTER TABLE "Recipe" DROP CONSTRAINT "Recipe_importId_fkey";

UPDATE "AiJob" SET "entityId" = 'meal_' || "entityId", "mealInputId" = 'meal_' || COALESCE("mealInputId", "entityId"), "entityType" = 'AI_INGESTION'
WHERE "entityType" = 'MEAL_INPUT';
UPDATE "AiJob" SET "entityId" = 'recipe_' || "entityId", "mealInputId" = 'recipe_' || "entityId", "entityType" = 'AI_INGESTION'
WHERE "entityType" = 'RECIPE_IMPORT';
UPDATE "Recipe" SET "importId" = 'recipe_' || "importId" WHERE "importId" IS NOT NULL;

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
