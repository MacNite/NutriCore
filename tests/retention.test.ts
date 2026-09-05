/**
 * Retention, against a real PostgreSQL.
 *
 * These sweeps delete and overwrite user data on a timer, which makes the
 * boundary conditions the whole story: a `where` clause that is slightly too
 * broad does not fail loudly, it quietly removes records somebody still wanted.
 * So every case here asserts both halves - that the old thing goes, and that
 * the recent thing beside it stays.
 *
 * Skipped automatically when TEST_DATABASE_URL is not configured.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { minimiseIngestionText, pruneFinishedJobs, pruneSettledInvitations, retentionPolicy } from "@/server/retention";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

const prisma = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://unused" } } });

const policy = retentionPolicy({} as NodeJS.ProcessEnv);
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

describeDb("retention", () => {
  let userId: string;
  const stamp = `ret${Date.now().toString(36)}`;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `${stamp}@test.local`, username: stamp, passwordHash: "x" },
    });
    userId = user.id;
  }, 30_000);

  afterEach(async () => {
    await prisma.aiIngestionInput.deleteMany({ where: { userId } });
    await prisma.aiJob.deleteMany({ where: { userId } });
    await prisma.userInvitation.deleteMany({ where: { invitedById: userId } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const ingestion = (createdAt: Date) =>
    prisma.aiIngestionInput.create({
      data: { userId, intent: "MEAL", text: "two slices of rye bread", sourceUrl: "https://example.com/recipe", createdAt },
    });

  it("empties ingestion text past the window and leaves recent text alone", async () => {
    const old = await ingestion(daysAgo(policy.ingestionTextDays + 1));
    const recent = await ingestion(daysAgo(1));

    expect(await minimiseIngestionText(policy)).toBe(1);

    const swept = await prisma.aiIngestionInput.findUniqueOrThrow({ where: { id: old.id } });
    expect(swept.text).toBe("");
    expect(swept.sourceUrl).toBeNull();
    // The row itself survives: Recipe.importId points at it, and that link is
    // the provenance saying a recipe came from an import at all.
    const kept = await prisma.aiIngestionInput.findUniqueOrThrow({ where: { id: recent.id } });
    expect(kept.text).toBe("two slices of rye bread");
  });

  it("does not rewrite a row it has already emptied", async () => {
    await ingestion(daysAgo(policy.ingestionTextDays + 1));
    expect(await minimiseIngestionText(policy)).toBe(1);
    // Otherwise every pass rewrites every old row for ever.
    expect(await minimiseIngestionText(policy)).toBe(0);
  });

  const job = (status: "COMPLETED" | "FAILED" | "QUEUED", createdAt: Date) =>
    prisma.aiJob.create({
      data: { userId, entityType: "MEAL", entityId: "e", status, createdAt },
    });

  it("keeps failed diagnostics longer than successful ones", async () => {
    const oldSuccess = await job("COMPLETED", daysAgo(policy.succeededJobDays + 1));
    // Older than the success window but inside the failure one: the case the
    // two separate windows exist for.
    const midFailure = await job("FAILED", daysAgo(policy.succeededJobDays + 1));
    const oldFailure = await job("FAILED", daysAgo(policy.failedJobDays + 1));

    expect(await pruneFinishedJobs(policy)).toBe(2);
    expect(await prisma.aiJob.findUnique({ where: { id: oldSuccess.id } })).toBeNull();
    expect(await prisma.aiJob.findUnique({ where: { id: oldFailure.id } })).toBeNull();
    expect(await prisma.aiJob.findUnique({ where: { id: midFailure.id } })).not.toBeNull();
  });

  it("never touches a job that has not finished", async () => {
    // A queued job is work still owed to a user, however old the row is.
    const queued = await job("QUEUED", daysAgo(365));
    expect(await pruneFinishedJobs(policy)).toBe(0);
    expect(await prisma.aiJob.findUnique({ where: { id: queued.id } })).not.toBeNull();
  });

  const invitation = (data: { acceptedAt?: Date; revokedAt?: Date; expiresAt: Date }) =>
    prisma.userInvitation.create({
      data: {
        email: `invite-${Math.random().toString(36).slice(2)}@test.local`,
        tokenHash: Math.random().toString(36).slice(2),
        invitedById: userId,
        ...data,
      },
    });

  it("removes settled invitations and keeps live ones", async () => {
    const accepted = await invitation({ acceptedAt: daysAgo(policy.invitationDays + 1), expiresAt: daysAgo(100) });
    const revoked = await invitation({ revokedAt: daysAgo(policy.invitationDays + 1), expiresAt: daysAgo(100) });
    const expired = await invitation({ expiresAt: daysAgo(policy.invitationDays + 1) });
    // Long expired but only just: still inside the audit window.
    const recentlyExpired = await invitation({ expiresAt: daysAgo(1) });
    // Not yet expired at all. This is the one a too-broad clause would take.
    const live = await invitation({ expiresAt: new Date(Date.now() + 60 * 60 * 1000) });

    expect(await pruneSettledInvitations(policy)).toBe(3);

    for (const gone of [accepted, revoked, expired]) {
      expect(await prisma.userInvitation.findUnique({ where: { id: gone.id } })).toBeNull();
    }
    for (const kept of [recentlyExpired, live]) {
      expect(await prisma.userInvitation.findUnique({ where: { id: kept.id } })).not.toBeNull();
    }
  });

  it("disables a sweep when its window is zero", async () => {
    const old = await ingestion(daysAgo(1000));
    await job("COMPLETED", daysAgo(1000));
    await invitation({ expiresAt: daysAgo(1000) });

    const off = { ingestionTextDays: 0, succeededJobDays: 0, failedJobDays: 0, invitationDays: 0 };
    expect(await minimiseIngestionText(off)).toBe(0);
    expect(await pruneFinishedJobs(off)).toBe(0);
    expect(await pruneSettledInvitations(off)).toBe(0);
    expect((await prisma.aiIngestionInput.findUniqueOrThrow({ where: { id: old.id } })).text).not.toBe("");
  });
});
