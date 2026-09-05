import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { RateLimitResult } from "@/lib/rate-limit";

/**
 * A fixed-window rate limiter held in PostgreSQL.
 *
 * The in-memory limiter is a `Map`, which means every limit resets when the
 * process does and each replica carries its own budget. For search, or for
 * pacing calls to a provider, that is fine and it stays where it is.
 *
 * For the limits that exist to stop an attacker rather than to be polite -
 * sign-in, registration, invitation redemption - it meant a fresh allowance
 * every time the container restarted, and nothing afterwards recording that
 * anything had happened. A restart is not a rare event on a self-hosted box
 * that also runs an image upgrade whenever the operator remembers to.
 *
 * One row per key per window. Deliberately not a log of attempts: a fixed
 * window needs a counter and an expiry, and a table growing a row per request
 * would be its own denial of service.
 */

/**
 * Counts one hit against `key` and says whether it is allowed.
 *
 * The whole decision is a single statement, so concurrent callers cannot
 * interleave a read and a write and both conclude they were under the limit.
 * `ON CONFLICT` makes the insert and the increment the same operation, and the
 * `CASE` resets the window in the same breath when the old one has passed - so
 * an expired row needs no separate cleanup pass to become usable again.
 */
export async function durableRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = new Date(),
): Promise<RateLimitResult> {
  const resetAt = new Date(now.getTime() + windowMs);

  const [bucket] = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
    VALUES (${key}, 1, ${resetAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN ${resetAt} ELSE "RateLimitBucket"."resetAt" END
    RETURNING "count", "resetAt"
  `;

  const retryAfterSeconds = Math.max(0, Math.ceil((bucket.resetAt.getTime() - now.getTime()) / 1000));
  return bucket.count > limit
    ? { allowed: false, remaining: 0, retryAfterSeconds }
    : { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

/**
 * The same decision, but never failing closed on a database problem.
 *
 * A limiter that cannot reach the database must not become the reason nobody
 * can sign in. `fallback` is the in-memory result already computed by the
 * caller, which is a real limit rather than an open door - so a database
 * outage degrades this to exactly the behaviour that existed before.
 */
export async function durableRateLimitOrFallback(
  key: string,
  limit: number,
  windowMs: number,
  fallback: RateLimitResult,
): Promise<RateLimitResult> {
  try {
    return await durableRateLimit(key, limit, windowMs);
  } catch (error) {
    logger.warn("Durable rate limit unavailable; using the in-memory limit", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return fallback;
  }
}

/** Drops windows that have passed, so the table cannot grow without bound. */
export async function pruneRateLimitBuckets(now = new Date()) {
  const { count } = await prisma.rateLimitBucket.deleteMany({ where: { resetAt: { lte: now } } });
  return count;
}
