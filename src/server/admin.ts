import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { hashSessionToken } from "@/lib/auth";
import { sendInvitationMail } from "@/lib/mail";

export const invitationExpiryMs = () => {
  const hours = Number(process.env.INVITATION_EXPIRY_HOURS ?? 48);
  return (Number.isFinite(hours) && hours > 0 ? hours : 48) * 3_600_000;
};

export async function issueInvitation(input: { email: string; name?: string; role?: "USER" | "ADMIN"; invitedById: string }) {
  const token = randomBytes(32).toString("base64url");
  const invitation = await prisma.userInvitation.create({
    data: {
      email: input.email.trim().toLowerCase(), name: input.name?.trim() || null,
      role: input.role ?? "USER", tokenHash: hashSessionToken(token), invitedById: input.invitedById,
      expiresAt: new Date(Date.now() + invitationExpiryMs()),
    },
  });
  return { invitation, token };
}

export const invitationUrl = (token: string) =>
  new URL(`/invite/${token}`, process.env.APP_URL ?? "http://localhost:3000").toString();

export async function deliverInvitation(input: Awaited<ReturnType<typeof issueInvitation>>) {
  return sendInvitationMail({
    to: input.invitation.email,
    name: input.invitation.name,
    inviteUrl: invitationUrl(input.token),
    expiresAt: input.invitation.expiresAt,
  });
}

export async function redeemableInvitation(token: string) {
  const invitation = await prisma.userInvitation.findUnique({ where: { tokenHash: hashSessionToken(token) } });
  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) return null;
  return invitation;
}
