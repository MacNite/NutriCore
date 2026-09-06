-- Letting a member say that a shared food's nutrition is wrong.
--
-- The mirror image of the enrichment review: there a machine proposes and a
-- person decides, here a person proposes and an administrator decides. Both end
-- in a value on the food and a FoodSource row saying where it came from.
--
-- Only foods nobody owns can be reported. That is not enforced here - a report
-- is written by application code that checks it - because the same food row
-- carries both the catalogue and everybody's custom foods.

-- CreateEnum
CREATE TYPE "public"."FoodReportStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "public"."FoodReport" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "comment" TEXT,
    "sourceUrl" TEXT,
    "servingSize" DECIMAL(10,3),
    "status" "public"."FoodReportStatus" NOT NULL DEFAULT 'OPEN',
    "servingStatus" "public"."FoodReportStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FoodReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FoodReportValue" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "nutrientKey" TEXT NOT NULL,
    "currentValue" DECIMAL(18,6),
    "proposedValue" DECIMAL(18,6) NOT NULL,
    "decidedValue" DECIMAL(18,6),
    "status" "public"."FoodReportStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "FoodReportValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FoodReport_status_createdAt_idx" ON "public"."FoodReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FoodReport_foodId_idx" ON "public"."FoodReport"("foodId");

-- CreateIndex
CREATE INDEX "FoodReport_reporterId_idx" ON "public"."FoodReport"("reporterId");

-- CreateIndex
CREATE INDEX "FoodReportValue_status_idx" ON "public"."FoodReportValue"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FoodReportValue_reportId_nutrientKey_key" ON "public"."FoodReportValue"("reportId", "nutrientKey");

-- AddForeignKey
ALTER TABLE "public"."FoodReport" ADD CONSTRAINT "FoodReport_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "public"."Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FoodReport" ADD CONSTRAINT "FoodReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FoodReportValue" ADD CONSTRAINT "FoodReportValue_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "public"."FoodReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
