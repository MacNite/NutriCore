-- A credential one phone uses to push health samples without a session.
--
-- The settings-page file import runs as the signed-in user. A phone syncing on
-- a schedule has no session, so it carries a long-lived token instead; only the
-- SHA-256 of that token is stored, as for `Session`.
--
-- The platform is fixed at issue time rather than sent per request, because
-- `HealthImportRecord.externalId` is only unique within a platform and a token
-- lifted from one phone should not be able to write under the other's identity.
--
-- NOTE: as with the RateLimitBucket and health import migrations, `prisma
-- migrate dev` also wants to drop the five gin_trgm_ops food-search indexes
-- created by raw SQL in the init migration, because it cannot see them in
-- schema.prisma. Those DROP INDEX statements have been removed.

CREATE TABLE "public"."HealthDeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "platform" "public"."HealthImportPlatform" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "HealthDeviceToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HealthDeviceToken_tokenHash_key" ON "public"."HealthDeviceToken"("tokenHash");

CREATE INDEX "HealthDeviceToken_userId_idx" ON "public"."HealthDeviceToken"("userId");

ALTER TABLE "public"."HealthDeviceToken"
    ADD CONSTRAINT "HealthDeviceToken_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
