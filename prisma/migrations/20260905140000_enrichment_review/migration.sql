-- Holding proposed nutrition for review before it reaches a food.
--
-- Enrichment was the only AI path in the app that wrote its results straight
-- into shared data; every other one produces something a person confirms. These
-- two tables are that step, and the second half of the migration reconstructs a
-- proposal for every value the backfill applied before they existed, so nothing
-- already in the catalogue stays unreviewed.

-- CreateEnum
CREATE TYPE "public"."EnrichmentReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "public"."UserProfile" ADD COLUMN     "autoApplyEnrichment" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public"."EnrichmentProposal" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "model" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "requestedKeys" TEXT[],
    "servingSizeG" DECIMAL(10,2),
    "servingStatus" "public"."EnrichmentReviewStatus" NOT NULL DEFAULT 'PENDING',
    "servingApplied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrichmentProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EnrichmentProposalValue" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "nutrientKey" TEXT NOT NULL,
    "value" DECIMAL(18,6) NOT NULL,
    "status" "public"."EnrichmentReviewStatus" NOT NULL DEFAULT 'PENDING',
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "EnrichmentProposalValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnrichmentProposal_foodId_idx" ON "public"."EnrichmentProposal"("foodId");

-- CreateIndex
CREATE INDEX "EnrichmentProposal_createdAt_idx" ON "public"."EnrichmentProposal"("createdAt");

-- CreateIndex
CREATE INDEX "EnrichmentProposalValue_status_idx" ON "public"."EnrichmentProposalValue"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EnrichmentProposalValue_proposalId_nutrientKey_key" ON "public"."EnrichmentProposalValue"("proposalId", "nutrientKey");

-- AddForeignKey
ALTER TABLE "public"."EnrichmentProposal" ADD CONSTRAINT "EnrichmentProposal_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "public"."Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EnrichmentProposalValue" ADD CONSTRAINT "EnrichmentProposalValue_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "public"."EnrichmentProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Retro-review: one proposal per food that already carries AI-applied values.
--
-- `20260905120000_ai_enrichment_origin` marked those values; this reconstructs
-- the run behind them from the AI_ENRICHMENT FoodSource audit record - its URL,
-- model and timestamp - so they arrive in the review queue exactly like a new
-- run would, except already applied. Approving one keeps it; rejecting takes it
-- back out. A database that has never been enriched matches nothing here.
INSERT INTO "public"."EnrichmentProposal" ("id", "foodId", "sourceUrl", "model", "retrievedAt", "requestedKeys", "createdAt")
SELECT
  gen_random_uuid()::text,
  fn."foodId",
  (SELECT fs."url" FROM "public"."FoodSource" fs
    WHERE fs."foodId" = fn."foodId" AND fs."provider" = 'AI_ENRICHMENT'
    ORDER BY fs."retrievedAt" DESC LIMIT 1),
  (SELECT fs."model" FROM "public"."FoodSource" fs
    WHERE fs."foodId" = fn."foodId" AND fs."provider" = 'AI_ENRICHMENT'
    ORDER BY fs."retrievedAt" DESC LIMIT 1),
  COALESCE(
    (SELECT fs."retrievedAt" FROM "public"."FoodSource" fs
      WHERE fs."foodId" = fn."foodId" AND fs."provider" = 'AI_ENRICHMENT'
      ORDER BY fs."retrievedAt" DESC LIMIT 1),
    CURRENT_TIMESTAMP
  ),
  ARRAY(
    SELECT DISTINCT inner_fn."nutrientKey" FROM "public"."FoodNutrient" inner_fn
    WHERE inner_fn."foodId" = fn."foodId" AND inner_fn."origin" = 'AI_ENRICHMENT'
  ),
  CURRENT_TIMESTAMP
FROM "public"."FoodNutrient" fn
WHERE fn."origin" = 'AI_ENRICHMENT' AND fn."value" IS NOT NULL
GROUP BY fn."foodId";

-- The values themselves: pending a decision, but already live on the food.
INSERT INTO "public"."EnrichmentProposalValue" ("id", "proposalId", "nutrientKey", "value", "status", "applied")
SELECT gen_random_uuid()::text, ep."id", fn."nutrientKey", fn."value", 'PENDING', true
FROM "public"."FoodNutrient" fn
JOIN "public"."EnrichmentProposal" ep ON ep."foodId" = fn."foodId"
WHERE fn."origin" = 'AI_ENRICHMENT' AND fn."value" IS NOT NULL;
