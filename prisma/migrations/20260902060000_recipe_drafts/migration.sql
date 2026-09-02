-- An AI-extracted recipe is kept as a draft until the user confirms it: it is
-- listed with their recipes but gets no Food entry, so nothing can be logged
-- from numbers nobody has reviewed yet.
CREATE TYPE "RecipeStatus" AS ENUM ('DRAFT', 'ACTIVE');
ALTER TABLE "Recipe" ADD COLUMN "status" "RecipeStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "importId" TEXT;
CREATE INDEX "Recipe_ownerId_status_idx" ON "Recipe"("ownerId", "status");
CREATE INDEX "Recipe_importId_idx" ON "Recipe"("importId");
-- The import is disposable context; losing it must not take the recipe with it.
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_importId_fkey" FOREIGN KEY ("importId") REFERENCES "RecipeImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
