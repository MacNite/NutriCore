"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { hashPassword, passwordProblem } from "@/lib/auth";
import { endSession, requireAdmin, requireUser } from "./session";
import { issueInvitation, redeemableInvitation } from "./admin";
import { ENRICHMENT_BATCH_LIMIT, ENRICHMENT_RETRY_MS, missingNutritionKeys } from "./food-enrichment";
import { AI_JOB_OPERATIONS, AI_JOB_SELECTION_OPERATIONS, jobPriority, STUCK_RUNNING_MS, type AiJobOperation } from "./ai-types";
import { discardMealInputImages } from "./meal-image";

/**
 * The token travels back in the redirect so `/admin` can show the link once.
 * NutriCore sends no email, so this is the only place the plaintext token ever
 * exists after issuing; it reaches the admin's own address bar and nowhere
 * else. A lost link is replaced by issuing a new one with "Resend".
 */
export async function inviteUserAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = z
    .object({
      email: z.string().trim().toLowerCase().pipe(z.email()),
      name: z.string().trim().max(80).optional(),
      role: z.enum(["USER", "ADMIN"]).default("USER"),
    })
    .parse(Object.fromEntries(formData));

  const { invitation, token } = await issueInvitation({ ...parsed, invitedById: admin.id });
  logger.info("Invitation issued", { invitationId: invitation.id, role: invitation.role, by: admin.id });
  redirect(`/admin?token=${encodeURIComponent(token)}`);
}

export async function resendInvitationAction(formData: FormData) {
  const admin = await requireAdmin();
  const previous = await prisma.userInvitation.findUnique({ where: { id: String(formData.get("invitationId")) } });
  if (!previous || previous.acceptedAt) throw new Error("Invitation cannot be resent");

  await prisma.userInvitation.update({ where: { id: previous.id }, data: { revokedAt: new Date() } });
  const { invitation, token } = await issueInvitation({
    email: previous.email,
    name: previous.name ?? undefined,
    role: previous.role,
    invitedById: admin.id,
  });
  logger.info("Invitation reissued", { invitationId: invitation.id, replaces: previous.id, by: admin.id });
  redirect(`/admin?token=${encodeURIComponent(token)}`);
}

export async function setUserActiveAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("userId"));
  const active = String(formData.get("active")) === "true";
  if (id === admin.id && !active) throw new Error("Administrators cannot deactivate their own account");

  // Deactivating ends the sessions too, or the account stays usable until they expire.
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { active } }),
    ...(active ? [] : [prisma.session.deleteMany({ where: { userId: id } })]),
  ]);
  redirect("/admin");
}

/** Shared by every path that puts a job back on the queue. */
const requeueData = {
  status: "QUEUED" as const,
  errorMessage: null,
  errorDetail: null,
  failureKind: null,
  failedAt: null,
  startedAt: null,
  completedAt: null,
  retryCount: 0,
};

/** A manual retry hands the job a fresh budget, not one more attempt on an exhausted one. */
export async function retryAiJobAction(formData: FormData) {
  await requireAdmin();
  await prisma.aiJob.updateMany({
    where: { id: String(formData.get("jobId")), status: "FAILED" },
    data: requeueData,
  });
  redirect("/admin");
}

const SELECTION_OPERATIONS = new Set<AiJobOperation>(AI_JOB_SELECTION_OPERATIONS);

/**
 * Bulk queue management. Selection-scoped operations act on the checked rows
 * only; the four sweep operations act on a status and need no selection, which
 * is what makes a queue of several hundred enrichment jobs recoverable at all.
 *
 * The `filter` field round-trips so the administrator lands back on the view
 * they were looking at rather than on the unfiltered list.
 */
export async function manageAiJobsAction(formData: FormData) {
  await requireAdmin();
  const operation = z.enum(AI_JOB_OPERATIONS).catch("requeue").parse(String(formData.get("operation") ?? ""));
  const filter = String(formData.get("filter") ?? "");
  const ids = formData
    .getAll("jobId")
    .map(String)
    .filter((id) => /^[a-z0-9]{20,40}$/i.test(id))
    .slice(0, 1000);

  // A selection operation with nothing selected is a no-op, never a sweep.
  if (SELECTION_OPERATIONS.has(operation) && ids.length === 0) {
    redirect(adminJobsUrl(filter, "noSelection", 0));
  }

  let affected = 0;
  const discardFor = async (where: Prisma.AiJobWhereInput) => {
    const jobs = await prisma.aiJob.findMany({ where: { ...where, entityType: "MEAL_INPUT" }, select: { entityId: true } });
    await discardMealInputImages(jobs.map((job) => job.entityId));
  };
  switch (operation) {
    case "requeue": {
      const result = await prisma.aiJob.updateMany({ where: { id: { in: ids } }, data: requeueData });
      affected = result.count;
      break;
    }
    case "cancel": {
      // Cancelling is recorded as a failure with a reason, so the row still
      // explains itself later instead of looking like an unexplained stop.
      const result = await prisma.aiJob.updateMany({
        where: { id: { in: ids }, status: { in: ["QUEUED", "RUNNING"] } },
        data: { status: "FAILED", failedAt: new Date(), failureKind: "CANCELLED", errorMessage: "Cancelled by an administrator", errorDetail: null },
      });
      affected = result.count;
      await discardFor({ id: { in: ids }, status: "FAILED", failureKind: "CANCELLED" });
      break;
    }
    case "delete": {
      await discardFor({ id: { in: ids } });
      const result = await prisma.aiJob.deleteMany({ where: { id: { in: ids } } });
      affected = result.count;
      break;
    }
    case "requeueAllFailed": {
      const result = await prisma.aiJob.updateMany({ where: { status: "FAILED" }, data: requeueData });
      affected = result.count;
      break;
    }
    case "deleteCompleted": {
      await discardFor({ status: "COMPLETED" });
      const result = await prisma.aiJob.deleteMany({ where: { status: "COMPLETED" } });
      affected = result.count;
      break;
    }
    case "deleteFailed": {
      await discardFor({ status: "FAILED" });
      const result = await prisma.aiJob.deleteMany({ where: { status: "FAILED" } });
      affected = result.count;
      break;
    }
    case "unstickRunning": {
      const result = await prisma.aiJob.updateMany({
        where: { status: "RUNNING", startedAt: { lt: new Date(Date.now() - STUCK_RUNNING_MS) } },
        data: requeueData,
      });
      affected = result.count;
      break;
    }
  }

  logger.info("AI jobs managed", { operation, affected, ids: ids.length });
  redirect(adminJobsUrl(filter, operation, affected));
}

const adminJobsUrl = (filter: string, operation: string, affected: number) => {
  const params = new URLSearchParams({ jobsOp: operation, jobsCount: String(affected) });
  if (filter) params.set("jobs", filter);
  return `/admin?${params}#ai-jobs`;
};

/**
 * On-demand only: deliberately no scheduler, so an administrator controls
 * network use.
 *
 * Bounded in two ways. `ENRICHMENT_BATCH_LIMIT` caps one click, because each job
 * holds the single worker for the length of a model call and an uncapped sweep
 * over a large catalogue buried every user-facing job behind it. And a food is
 * skipped for `ENRICHMENT_RETRY_MS` after an attempt: most gaps cannot be filled
 * from one page, so without that the same foods were re-queued on every click.
 *
 * Press it again to take the next batch.
 */
export async function enqueueFoodEnrichmentAction() {
  const admin = await requireAdmin();
  const retryBefore = new Date(Date.now() - ENRICHMENT_RETRY_MS);
  const [definitions, foods] = await Promise.all([
    prisma.nutrientDefinition.findMany({ select: { key: true } }),
    prisma.food.findMany({
      where: { OR: [{ enrichedAt: null }, { enrichedAt: { lt: retryBefore } }] },
      include: { nutrients: true, servings: true },
      // Oldest attempt first, so repeated clicks work through the catalogue
      // instead of offering the same foods again.
      orderBy: [{ enrichedAt: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  let queued = 0;
  let remaining = 0;
  for (const food of foods) {
    const missing = missingNutritionKeys(definitions, food.nutrients);
    const missingServing = !food.servingSize && !food.servings.some((s) => s.gramEquivalent || s.mlEquivalent);
    if (!missing.length && !missingServing) continue;
    if (queued >= ENRICHMENT_BATCH_LIMIT) {
      remaining++;
      continue;
    }
    const active = await prisma.aiJob.findFirst({ where: { entityType: "FOOD_ENRICHMENT", entityId: food.id, status: { in: ["QUEUED", "RUNNING"] } } });
    if (!active) {
      await prisma.aiJob.create({
        data: { userId: admin.id, entityType: "FOOD_ENRICHMENT", entityId: food.id, priority: jobPriority("FOOD_ENRICHMENT") },
      });
      queued++;
    }
  }
  redirect(`/admin?enrichmentQueued=${queued}&enrichmentRemaining=${remaining}#ai-jobs`);
}

export async function changeRequiredPasswordAction(formData: FormData) {
  const user = await requireUser();
  if (!user.mustChangePassword) redirect("/");
  const password = String(formData.get("password"));
  if (passwordProblem(password)) redirect("/change-password?error=weak");

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), mustChangePassword: false },
  });
  await prisma.session.deleteMany({ where: { userId: user.id } });
  // endSession clears both the session and the password-change gate cookie.
  await endSession();
  redirect("/login?passwordChanged=1");
}

export async function acceptInvitationAction(formData: FormData) {
  const token = String(formData.get("token"));
  const invitation = await redeemableInvitation(token);
  if (!invitation) redirect(`/invite/${encodeURIComponent(token)}?error=invalid`);

  const username = String(formData.get("username")).trim();
  const password = String(formData.get("password"));
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username) || passwordProblem(password))
    redirect(`/invite/${encodeURIComponent(token)}?error=invalidInput`);

  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.userInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error("Invitation already used");
      await tx.user.create({
        data: {
          email: invitation.email,
          username,
          passwordHash: await hashPassword(password),
          role: invitation.role,
          profile: { create: { displayName: invitation.name || username } },
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      redirect(`/invite/${encodeURIComponent(token)}?error=exists`);
    throw error;
  }
  redirect("/login?invited=1");
}
