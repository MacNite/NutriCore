import { prisma } from "@/lib/db";
import { createHealthToken, hashHealthToken } from "@/lib/health-token";
import type { HealthPlatform } from "@/lib/health-import";
import { logger } from "@/lib/logger";

/**
 * Issuing, listing, revoking and checking the tokens a phone syncs with.
 *
 * Everything here is deliberately small. The interesting decisions were made in
 * `src/lib/health-token.ts` (what a token is) and in the schema (that only its
 * hash is kept); what is left is the handful of queries those decisions imply.
 */

/**
 * How many tokens one account may hold.
 *
 * Not a security boundary - the owner is the only one who can create them - but
 * a list that grows without bound is a list nobody revokes anything from. Two
 * phones and a spare is the shape of the real case.
 */
export const MAX_DEVICE_TOKENS = 10;

export interface DeviceTokenSummary {
  id: string;
  name: string;
  platform: HealthPlatform;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export const listDeviceTokens = (userId: string): Promise<DeviceTokenSummary[]> =>
  prisma.healthDeviceToken.findMany({
    where: { userId },
    select: { id: true, name: true, platform: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "desc" },
  });

/**
 * Issue a token, returning the secret exactly once.
 *
 * The plaintext is never stored and never recoverable, so the caller has one
 * chance to show it. That is a worse experience than a token the user can look
 * up again, and it is the entire point: a database that could hand the token
 * back is a database that hands it to whoever reads it.
 */
export type CreatedDeviceToken = { token: string; device: DeviceTokenSummary } | { error: "tooMany" };

export async function createDeviceToken(userId: string, name: string, platform: HealthPlatform): Promise<CreatedDeviceToken> {
  const count = await prisma.healthDeviceToken.count({ where: { userId } });
  if (count >= MAX_DEVICE_TOKENS) return { error: "tooMany" };

  const { token, tokenHash } = createHealthToken();
  const created = await prisma.healthDeviceToken.create({
    data: { userId, name, platform, tokenHash },
    select: { id: true, name: true, platform: true, createdAt: true, lastUsedAt: true },
  });

  return { token, device: created as DeviceTokenSummary };
}

/** Revoking is deleting. Scoped by user, so an id from elsewhere finds nothing. */
export async function revokeDeviceToken(userId: string, id: string) {
  const { count } = await prisma.healthDeviceToken.deleteMany({ where: { id, userId } });
  return count > 0;
}

export interface AuthenticatedDevice {
  id: string;
  userId: string;
  name: string;
  platform: HealthPlatform;
}

/**
 * Resolve a presented token to the device that holds it, or null.
 *
 * The lookup is by hash on a unique index, so it is one indexed read and there
 * is nothing to compare in constant time afterwards: an attacker who could
 * measure this would learn whether a hash exists, which is the same thing the
 * status code tells them anyway.
 *
 * `active` is checked here rather than left to the caller. A deactivated
 * account keeps its rows - that is what makes deactivation reversible - and a
 * phone that went on syncing into one would be a quiet hole in it.
 */
export async function authenticateDevice(token: string): Promise<AuthenticatedDevice | null> {
  const device = await prisma.healthDeviceToken.findUnique({
    where: { tokenHash: hashHealthToken(token) },
    select: { id: true, userId: true, name: true, platform: true, user: { select: { active: true } } },
  });

  if (!device || !device.user.active) return null;
  return { id: device.id, userId: device.userId, name: device.name, platform: device.platform };
}

/**
 * Record that a device synced, without letting the bookkeeping fail the sync.
 *
 * `lastUsedAt` exists so somebody can see which phone has stopped reporting. It
 * is not worth returning an error to a device that has just successfully handed
 * over its samples, so a failure here is logged and swallowed.
 */
export async function markDeviceUsed(id: string, now = new Date()) {
  try {
    await prisma.healthDeviceToken.update({ where: { id }, data: { lastUsedAt: now } });
  } catch (error) {
    logger.warn("Could not record health device usage", {
      device: id,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}
