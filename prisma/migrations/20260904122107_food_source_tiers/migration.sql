-- Locale-aware, tiered food sources.
--
-- `prisma migrate dev` proposes dropping the three pg_trgm GIN indexes the
-- initial migration creates by hand, because they are not expressible in the
-- Prisma schema. Those DROP statements have been removed: they would silently
-- turn every fuzzy food search into a sequential scan. New trgm indexes for
-- the tables this migration adds are created the same way, at the end.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."SourceType" ADD VALUE 'BLS';
ALTER TYPE "public"."SourceType" ADD VALUE 'FATSECRET';

-- AlterTable
ALTER TABLE "public"."Food" ADD COLUMN     "cacheExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."FoodNutrient" ADD COLUMN     "origin" TEXT,
ADD COLUMN     "qualifier" TEXT;

-- CreateTable
CREATE TABLE "public"."FoodTranslation" (
    "foodId" TEXT NOT NULL,
    "locale" "public"."Locale" NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,

    CONSTRAINT "FoodTranslation_pkey" PRIMARY KEY ("foodId","locale")
);

-- CreateTable
CREATE TABLE "public"."DatasetImport" (
    "key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "stats" JSONB,
    "durationMs" INTEGER,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatasetImport_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "FoodTranslation_normalizedName_idx" ON "public"."FoodTranslation"("normalizedName");

-- CreateIndex
CREATE INDEX "Food_sourceType_idx" ON "public"."Food"("sourceType");

-- CreateIndex
CREATE INDEX "Food_cacheExpiresAt_idx" ON "public"."Food"("cacheExpiresAt");

-- AddForeignKey
ALTER TABLE "public"."FoodTranslation" ADD CONSTRAINT "FoodTranslation_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "public"."Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The trgm indexes below match the ones the initial migration creates for
-- Food.normalizedName: a food's translated name and its aliases are searched
-- with the same `contains` predicate, and BLS alone adds 7,140 German names
-- plus 7,140 English ones for the planner to work through.
CREATE INDEX "FoodTranslation_normalizedName_trgm_idx" ON "FoodTranslation" USING gin ("normalizedName" gin_trgm_ops);
CREATE INDEX "FoodAlias_name_trgm_idx" ON "FoodAlias" USING gin ("name" gin_trgm_ops);
