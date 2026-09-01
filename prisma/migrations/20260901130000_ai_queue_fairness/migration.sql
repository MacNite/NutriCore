-- Queue fairness and enrichment churn.
--
-- A "Backfill missing nutrition" sweep can queue one job per incomplete food.
-- With a strictly chronological queue every quick meal then waited behind all of
-- them, and because the sweep had no memory a food whose gaps could not be
-- filled was re-queued on every click.

-- Defaults to the user-facing value so a job type added later cannot be starved
-- by forgetting to set it; only background work opts down.
ALTER TABLE "AiJob" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 10;

-- Existing background backfilling moves behind everything else.
UPDATE "AiJob" SET "priority" = 0 WHERE "entityType" = 'FOOD_ENRICHMENT';

DROP INDEX IF EXISTS "AiJob_status_createdAt_idx";
CREATE INDEX "AiJob_status_priority_createdAt_idx" ON "AiJob"("status", "priority", "createdAt");

ALTER TABLE "Food" ADD COLUMN "enrichedAt" TIMESTAMP(3);

-- A research run now happens in the worker, so the URLs it was asked to fetch
-- have to outlive the request that submitted the form.
ALTER TABLE "ResearchJob" ADD COLUMN "requestedSourceUrls" JSONB;

-- Recipe extraction from a URL, an image or free text also moved into the
-- worker, so its input and its result need a home outside the request.
CREATE TABLE "RecipeImport" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "text" TEXT,
  "sourceUrl" TEXT,
  "imageMime" TEXT,
  "imageData" BYTEA,
  "draft" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecipeImport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecipeImport_userId_createdAt_idx" ON "RecipeImport"("userId", "createdAt");

ALTER TABLE "RecipeImport" ADD CONSTRAINT "RecipeImport_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
