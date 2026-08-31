"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { hashPassword, passwordProblem } from "@/lib/auth";
import { endSession, requireAdmin, requireUser } from "./session";
import { issueInvitation, redeemableInvitation } from "./admin";

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

/** A manual retry hands the job a fresh budget, not one more attempt on an exhausted one. */
export async function retryAiJobAction(formData: FormData) {
  await requireAdmin();
  await prisma.aiJob.updateMany({
    where: { id: String(formData.get("jobId")), status: "FAILED" },
    data: { status: "QUEUED", errorMessage: null, failedAt: null, startedAt: null, retryCount: 0 },
  });
  redirect("/admin");
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
