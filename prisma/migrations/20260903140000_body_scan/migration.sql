-- Guided two-view body scan.
--
-- The images live on the scan row rather than in object storage because this
-- deployment has none: the whole stack is Postgres, an app and a worker. They
-- are a transient worker handoff, cleared in the transaction that stores the
-- estimates, with `imagesExpireAt` as the deadline a sweeper enforces for
-- whatever a crash left behind. A database dump taken inside that window can
-- still contain them; the retention window is minutes, and the README says so.
--
-- Estimates are kept separately from measurements, and stay kept whatever the
-- reviewer decided. That is what makes an accepted value auditable: the record
-- of what the estimator claimed survives the user correcting it.

-- AlterEnum
ALTER TYPE "MeasurementSource" ADD VALUE 'OPTICAL_SCAN';

-- CreateEnum
CREATE TYPE "BodyScanState" AS ENUM ('QUEUED', 'PROCESSING', 'AWAITING_REVIEW', 'ACCEPTED', 'REJECTED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BodyScanDecision" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EDITED');

-- AlterTable
-- Per-value provenance. A field absent from the map was entered by hand, so
-- every existing row keeps its present meaning and no backfill is needed.
ALTER TABLE "BodyMeasurement" ADD COLUMN     "valueSources" JSONB;

-- CreateTable
CREATE TABLE "BodyScan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "state" "BodyScanState" NOT NULL DEFAULT 'QUEUED',
    "heightCm" DECIMAL(5,1) NOT NULL,
    "weightKg" DECIMAL(6,2),
    "consentVersion" TEXT NOT NULL,
    "frontMime" TEXT,
    "frontData" BYTEA,
    "sideMime" TEXT,
    "sideData" BYTEA,
    "imagesExpireAt" TIMESTAMP(3),
    "provider" TEXT,
    "processorModel" TEXT,
    "version" TEXT,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "qualityReasons" JSONB,
    "failureKind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "BodyScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyScanEstimate" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "valueCm" DECIMAL(5,1) NOT NULL,
    "lowerCm" DECIMAL(5,1) NOT NULL,
    "upperCm" DECIMAL(5,1) NOT NULL,
    "decision" "BodyScanDecision" NOT NULL DEFAULT 'PENDING',
    "acceptedCm" DECIMAL(5,1),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BodyScanEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BodyScan_userId_createdAt_idx" ON "BodyScan"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BodyScan_imagesExpireAt_idx" ON "BodyScan"("imagesExpireAt");

-- CreateIndex
CREATE INDEX "BodyScanEstimate_scanId_idx" ON "BodyScanEstimate"("scanId");

-- CreateIndex
CREATE UNIQUE INDEX "BodyScanEstimate_scanId_metricKey_key" ON "BodyScanEstimate"("scanId", "metricKey");

-- AddForeignKey
ALTER TABLE "BodyScan" ADD CONSTRAINT "BodyScan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyScanEstimate" ADD CONSTRAINT "BodyScanEstimate_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "BodyScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
