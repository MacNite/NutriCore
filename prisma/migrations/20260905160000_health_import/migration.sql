-- Importing weight and body history from an Apple Health or Health Connect export.
--
-- Two things are needed for the import rule to be expressible: a weight entry
-- has to say where its number came from, so a value someone typed can be
-- protected from a file; and a sample has to be recognisable on a second
-- import, so re-importing reconciles instead of duplicating.
--
-- `WeightEntry.source` defaults to MANUAL, which is exactly what every existing
-- row is, so nothing needs backfilling.
--
-- NOTE: as with the RateLimitBucket migration, `prisma migrate dev` also wants
-- to drop the five gin_trgm_ops food-search indexes created by raw SQL in the
-- init migration, because it cannot see them in schema.prisma. Those DROP INDEX
-- statements have been removed; dropping them was not intended here.

ALTER TYPE "public"."MeasurementSource" ADD VALUE 'HEALTH_PLATFORM';

CREATE TYPE "public"."HealthImportPlatform" AS ENUM ('APPLE_HEALTH', 'HEALTH_CONNECT');

ALTER TABLE "public"."WeightEntry"
    ADD COLUMN "source" "public"."MeasurementSource" NOT NULL DEFAULT 'MANUAL';

CREATE TABLE "public"."HealthImportRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "public"."HealthImportPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "value" DECIMAL(8,2) NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthImportRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HealthImportRecord_userId_platform_externalId_key"
    ON "public"."HealthImportRecord"("userId", "platform", "externalId");

CREATE INDEX "HealthImportRecord_userId_date_idx" ON "public"."HealthImportRecord"("userId", "date");

ALTER TABLE "public"."HealthImportRecord"
    ADD CONSTRAINT "HealthImportRecord_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
