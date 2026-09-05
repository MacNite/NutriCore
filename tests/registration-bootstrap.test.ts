/**
 * The bootstrap lock, against a real PostgreSQL.
 *
 * `registration.test.ts` asserts the shape of the fix: that a lock is taken,
 * that it is taken inside the transaction, and that it is taken before the
 * count. What it cannot assert - because it mocks the client - is the part the
 * fix actually depends on: that `pg_advisory_xact_lock` *blocks* a second
 * transaction until the first commits.
 *
 * That distinction is not academic. `pg_try_advisory_xact_lock` is four
 * characters away, reads almost identically, and returns false immediately
 * instead of waiting, which would restore the original race in full while every
 * mocked test kept passing. This test was checked against exactly that
 * substitution: with it, two administrators are created.
 *
 * Skipped automatically when TEST_DATABASE_URL is not configured.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

const prisma = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://unused" } } });

/** Must match `BOOTSTRAP_LOCK_KEY` in `src/server/registration.ts`. */
const BOOTSTRAP_LOCK_KEY = 4711001n;

describeDb("bootstrap advisory lock", () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, 30_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * Two concurrent transactions doing what `createSelfRegisteredUser` does:
   * lock, count, and create only when the count was zero.
   *
   * The count is scoped to this run's own username prefix rather than the whole
   * table, so the test says something true whether or not the database it runs
   * against already holds accounts. The locking discipline under test is
   * identical either way.
   */
  it("serialises two concurrent first-account registrations", async () => {
    const stamp = `boot${Date.now().toString(36)}`;
    const order: string[] = [];

    const register = async (label: string) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`;
        order.push(`${label}:locked`);
        const existing = await tx.user.count({ where: { username: { startsWith: stamp } } });
        if (existing > 0) {
          order.push(`${label}:refused`);
          return null;
        }
        const user = await tx.user.create({
          data: { email: `${label}-${stamp}@test.local`, username: `${stamp}${label}`, passwordHash: "x", role: "ADMIN" },
        });
        order.push(`${label}:created`);
        return user.id;
      });

    try {
      const [first, second] = await Promise.all([register("a"), register("b")]);

      // Exactly one account, and so exactly one administrator.
      const created = [first, second].filter(Boolean);
      expect(created).toHaveLength(1);

      const admins = await prisma.user.findMany({ where: { username: { startsWith: stamp } } });
      expect(admins).toHaveLength(1);

      expect(order.filter((step) => step.endsWith(":created"))).toHaveLength(1);
      expect(order.filter((step) => step.endsWith(":refused"))).toHaveLength(1);

      // The two transactions did not interleave. Whoever took the lock second
      // did so only after the first had already created its account - which is
      // exactly why it then counted one instead of zero. A non-blocking lock
      // would put both `:locked` steps before the `:created` one.
      const secondLock = Math.max(order.indexOf("a:locked"), order.indexOf("b:locked"));
      const createdAt = order.findIndex((step) => step.endsWith(":created"));
      expect(secondLock).toBeGreaterThan(createdAt);
    } finally {
      await prisma.user.deleteMany({ where: { username: { startsWith: stamp } } });
    }
  }, 30_000);
});
