-- Recipe publication: sharing a recipe with the other members of this instance.
--
-- As in `20260904122107_food_source_tiers`, `prisma migrate dev` proposes
-- dropping the pg_trgm GIN indexes the initial migration creates by hand,
-- because they are not expressible in the Prisma schema. Those DROP statements
-- have been removed: they would silently turn every fuzzy food search into a
-- sequential scan.

-- CreateEnum
CREATE TYPE "public"."PublicationStatus" AS ENUM ('PUBLISHED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "public"."Recipe" ADD COLUMN     "forkedFromAuthorSnapshot" TEXT,
ADD COLUMN     "forkedFromPublicationId" TEXT;

-- CreateTable
CREATE TABLE "public"."RecipePublication" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "sourceRecipeId" TEXT,
    "authorNameSnapshot" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "servings" DECIMAL(8,2) NOT NULL,
    "yieldWeightG" DECIMAL(10,2),
    "instructions" TEXT,
    "tags" TEXT[],
    "locale" "public"."Locale",
    "nutritionSnapshot" JSONB NOT NULL,
    "status" "public"."PublicationStatus" NOT NULL DEFAULT 'PUBLISHED',
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipePublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RecipePublicationIngredient" (
    "publicationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "displayName" TEXT NOT NULL,
    "brand" TEXT,
    "amount" DECIMAL(10,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "weightG" DECIMAL(10,3) NOT NULL,
    "normalizedMl" DECIMAL(10,3),
    "basisAmount" DECIMAL(10,3) NOT NULL,
    "basisUnit" "public"."BasisUnit" NOT NULL,
    "nutritionSnapshot" JSONB NOT NULL,
    "sourceType" "public"."SourceType" NOT NULL,
    "externalProvider" TEXT,
    "externalId" TEXT,
    "barcode" TEXT,
    "densityGPerMl" DECIMAL(10,5),
    "permanent" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RecipePublicationIngredient_pkey" PRIMARY KEY ("publicationId","position")
);

-- CreateIndex
CREATE INDEX "RecipePublication_status_publishedAt_idx" ON "public"."RecipePublication"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "RecipePublication_authorId_publishedAt_idx" ON "public"."RecipePublication"("authorId", "publishedAt");

-- CreateIndex
CREATE INDEX "RecipePublication_sourceRecipeId_idx" ON "public"."RecipePublication"("sourceRecipeId");

-- CreateIndex
CREATE INDEX "RecipePublicationIngredient_publicationId_idx" ON "public"."RecipePublicationIngredient"("publicationId");

-- CreateIndex
CREATE INDEX "Recipe_forkedFromPublicationId_idx" ON "public"."Recipe"("forkedFromPublicationId");

-- AddForeignKey
ALTER TABLE "public"."Recipe" ADD CONSTRAINT "Recipe_forkedFromPublicationId_fkey" FOREIGN KEY ("forkedFromPublicationId") REFERENCES "public"."RecipePublication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RecipePublication" ADD CONSTRAINT "RecipePublication_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RecipePublication" ADD CONSTRAINT "RecipePublication_sourceRecipeId_fkey" FOREIGN KEY ("sourceRecipeId") REFERENCES "public"."Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RecipePublicationIngredient" ADD CONSTRAINT "RecipePublicationIngredient_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "public"."RecipePublication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
