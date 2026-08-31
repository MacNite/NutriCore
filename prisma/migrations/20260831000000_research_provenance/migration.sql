-- Preserve meal/date context for synchronous research and add first-class recipe provenance.
ALTER TABLE "ResearchJob" ADD COLUMN "meal" "MealType";
ALTER TABLE "ResearchJob" ADD COLUMN "diaryDate" DATE;

CREATE TABLE "RecipeSource" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "title" TEXT,
    "url" TEXT NOT NULL,
    "provider" TEXT,
    "retrievedAt" TIMESTAMP(3),
    "metadata" JSONB,
    CONSTRAINT "RecipeSource_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RecipeSource_recipeId_idx" ON "RecipeSource"("recipeId");
ALTER TABLE "RecipeSource" ADD CONSTRAINT "RecipeSource_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
