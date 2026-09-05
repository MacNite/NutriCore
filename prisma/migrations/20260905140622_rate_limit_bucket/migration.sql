-- One fixed rate-limit window per key, shared by every process.
--
-- NOTE: `prisma migrate dev` also wanted to drop five gin_trgm_ops indexes
-- (Food_normalizedName_trgm_idx and friends). Those are created by raw SQL in
-- the init migration and cannot be expressed in schema.prisma, so Prisma sees
-- them as drift on every migration and proposes removing them. They are the
-- food search indexes and dropping them was not intended here; the DROP INDEX
-- statements have been removed from this migration.
CREATE TABLE "public"."RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "RateLimitBucket_resetAt_idx" ON "public"."RateLimitBucket"("resetAt");
