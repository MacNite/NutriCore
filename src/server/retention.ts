import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Retention for the records that had none.
 *
 * Raw imagery was already handled well: meal and scan uploads carry an explicit
 * expiry, are cleared as soon as they have been processed, and are swept every
 * minute. Nothing else was.
 *
 * `AiIngestionInput` also holds the *text* of what a user asked for - a meal
 * description, a source URL, a draft - and only its image column ever expired.
 * Meal descriptions are not incidental: over time they say what somebody eats,
 * when, how often, what they avoid, and a source URL can say where they shop.
 * `AiJob` and `AiJobAttempt` hold diagnostics, which are now redacted but still
 * accumulate one row per attempt for ever. `UserInvitation` keeps an email
 * address and a name after the invitation has been accepted, revoked or
 * expired, with nothing to remove it short of deleting the inviter.
 *
 * The windows below are defaults chosen to be useful rather than minimal: long
 * enough that history and failure diagnosis still work, short enough that "for
 * ever" stops being the answer. Each is configurable, and 0 disables that sweep
 * for a deployment that wants to keep everything.
 */

const days = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export interface RetentionPolicy {
  /** Free text and source URLs on ingestion inputs. Default 90 days. */
  ingestionTextDays: number;
  /** Diagnostics on jobs that succeeded: rarely interesting. Default 30 days. */
  succeededJobDays: number;
  /** Diagnostics on jobs that failed: the ones worth keeping. Default 90 days. */
  failedJobDays: number;
  /** Accepted, revoked or expired invitations. Default 30 days. */
  invitationDays: number;
}

export const retentionPolicy = (source: NodeJS.ProcessEnv = process.env): RetentionPolicy => ({
  ingestionTextDays: days(source.RETAIN_AI_INPUT_DAYS, 90),
  succeededJobDays: days(source.RETAIN_AI_JOB_DAYS, 30),
  failedJobDays: days(source.RETAIN_FAILED_AI_JOB_DAYS, 90),
  invitationDays: days(source.RETAIN_INVITATION_DAYS, 30),
});

const before = (days: number, now: Date) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

export interface SweepCounts {
  ingestionInputs: number;
  jobs: number;
  invitations: number;
}

/**
 * Minimises ingestion inputs past their window.
 *
 * The row is emptied rather than deleted. `Recipe.importId` and `AiJob`
 * reference it, and those references are the provenance trail that says a
 * recipe came from an import at all - deleting the row would either cascade
 * into a recipe the user still has or null out the link that explains it. What
 * the user typed goes; the fact that they imported something stays.
 */
export async function minimiseIngestionText(policy: RetentionPolicy, now = new Date()) {
  if (!policy.ingestionTextDays) return 0;
  const { count } = await prisma.aiIngestionInput.updateMany({
    where: {
      createdAt: { lt: before(policy.ingestionTextDays, now) },
      // Only rows still holding something, so a swept row is not rewritten on
      // every pass for ever.
      OR: [{ text: { not: "" } }, { sourceUrl: { not: null } }, { draft: { not: Prisma.DbNull } }],
    },
    data: { text: "", sourceUrl: null, draft: Prisma.DbNull },
  });
  return count;
}

/**
 * Deletes finished AI jobs past their window, with their attempts.
 *
 * Failures are kept about three times as long as successes: a successful job's
 * diagnostics are noise a month later, while a failure is the thing somebody
 * eventually asks about. `AiJobAttempt` and `AiProposal` cascade from the job.
 */
export async function pruneFinishedJobs(policy: RetentionPolicy, now = new Date()) {
  const windows = [
    { status: "COMPLETED" as const, days: policy.succeededJobDays },
    { status: "FAILED" as const, days: policy.failedJobDays },
  ].filter((window) => window.days > 0);

  let count = 0;
  for (const window of windows) {
    const { count: removed } = await prisma.aiJob.deleteMany({
      where: { status: window.status, createdAt: { lt: before(window.days, now) } },
    });
    count += removed;
  }
  return count;
}

/**
 * Deletes invitations that can no longer be redeemed and are past their window.
 *
 * Only ones already accepted, revoked or expired: a live invitation is never
 * touched, whatever its age, or a long `INVITATION_EXPIRY_HOURS` would have its
 * invitations swept out from under it.
 */
export async function pruneSettledInvitations(policy: RetentionPolicy, now = new Date()) {
  if (!policy.invitationDays) return 0;
  const cutoff = before(policy.invitationDays, now);
  const { count } = await prisma.userInvitation.deleteMany({
    where: {
      OR: [
        { acceptedAt: { lt: cutoff } },
        { revokedAt: { lt: cutoff } },
        { expiresAt: { lt: cutoff }, acceptedAt: null, revokedAt: null },
      ],
    },
  });
  return count;
}

/**
 * One pass of every retention sweep.
 *
 * Reports what it removed only when it removed something, so a quiet instance
 * does not write a line a minute saying nothing happened.
 */
export async function sweepRetention(policy = retentionPolicy(), now = new Date()): Promise<SweepCounts> {
  const counts: SweepCounts = {
    ingestionInputs: await minimiseIngestionText(policy, now),
    jobs: await pruneFinishedJobs(policy, now),
    invitations: await pruneSettledInvitations(policy, now),
  };
  if (counts.ingestionInputs || counts.jobs || counts.invitations) logger.info("Applied retention policy", { ...counts });
  return counts;
}
