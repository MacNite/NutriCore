/**
 * The durable limiter, against a real PostgreSQL.
 *
 * Its whole reason to exist is behaviour a mocked client cannot show: that the
 * count survives a process restart, and that concurrent callers cannot both
 * read a count under the limit and both be allowed. The second is a property of
 * the statement, not of the TypeScript around it.
 *
 * Skipped automatically when TEST_DATABASE_URL is not configured.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { durableRateLimit, durableRateLimitOrFallback, pruneRateLimitBuckets } from "@/server/durable-rate-limit";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

const prisma = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://unused" } } });

const key = (name: string) => `test:${name}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

describeDb("durable rate limit", () => {
  const used: string[] = [];
  const track = (name: string) => {
    const value = key(name);
    used.push(value);
    return value;
  };

  afterEach(async () => {
    await prisma.rateLimitBucket.deleteMany({ where: { key: { in: used.splice(0) } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("allows up to the limit and then refuses", async () => {
    const k = track("basic");
    for (let i = 1; i <= 3; i++) {
      const result = await durableRateLimit(k, 3, 60_000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3 - i);
    }
    const refused = await durableRateLimit(k, 3, 60_000);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts concurrent hits exactly once each", async () => {
    // The point of doing this in one statement. A read-then-write would let
    // several of these see the same count and all conclude they were under it.
    const k = track("concurrent");
    const results = await Promise.all(Array.from({ length: 10 }, () => durableRateLimit(k, 4, 60_000)));
    expect(results.filter((r) => r.allowed)).toHaveLength(4);
    expect(results.filter((r) => !r.allowed)).toHaveLength(6);
  });

  it("keeps the count outside the process, where a restart cannot reset it", async () => {
    const k = track("restart");
    await durableRateLimit(k, 2, 60_000);
    await durableRateLimit(k, 2, 60_000);

    // The count is in the database, not in a Map that dies with the process.
    // This is the difference from the in-memory limiter stated as a fact about
    // storage, which is the only place it can honestly be asserted.
    const stored = await prisma.rateLimitBucket.findUniqueOrThrow({ where: { key: k } });
    expect(stored.count).toBe(2);
    expect((await durableRateLimit(k, 2, 60_000)).allowed).toBe(false);
  });

  it("starts a new window once the old one has passed", async () => {
    const k = track("window");
    const start = new Date();
    expect((await durableRateLimit(k, 1, 1_000, start)).allowed).toBe(true);
    expect((await durableRateLimit(k, 1, 1_000, start)).allowed).toBe(false);
    // Past the window: the same row resets in place rather than needing a sweep.
    const later = new Date(start.getTime() + 2_000);
    expect((await durableRateLimit(k, 1, 1_000, later)).allowed).toBe(true);
  });

  it("falls back to the in-memory answer when the query fails", async () => {
    // A limiter that cannot reach its storage must not become the reason nobody
    // can sign in. A NUL byte is rejected by PostgreSQL's text encoding, which
    // fails the statement the way an unreachable database would - written as an
    // escape rather than as a raw byte in the source.
    const fallback = { allowed: true, remaining: 4, retryAfterSeconds: 0 };
    const key = `bad${String.fromCharCode(0)}key`;
    expect(await durableRateLimitOrFallback(key, 5, 60_000, fallback)).toEqual(fallback);
  });

  it("prunes only windows that have already passed", async () => {
    const expired = track("expired");
    const live = track("live");
    await durableRateLimit(expired, 5, 1_000, new Date(Date.now() - 10_000));
    await durableRateLimit(live, 5, 60_000);

    await pruneRateLimitBuckets();

    expect(await prisma.rateLimitBucket.findUnique({ where: { key: expired } })).toBeNull();
    expect(await prisma.rateLimitBucket.findUnique({ where: { key: live } })).not.toBeNull();
  });
});
