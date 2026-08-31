import { cookies, headers } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, SESSION_TTL_MS, createSessionToken, hashSessionToken } from "@/lib/auth";
import type { Locale } from "@/i18n/locales";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";

export interface SessionUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  language: Locale;
  theme: string;
  onboarded: boolean;
  aiEnabled: boolean;
  researchEnabled: boolean;
  role: "USER" | "ADMIN";
  mustChangePassword: boolean;
}

/**
 * Resolved once per request. Returns null instead of throwing so public routes
 * can render without a session.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: { include: { profile: true } } },
  });

  if (!session || session.expiresAt <= new Date() || !session.user.active) return null;

  const { user } = session;
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.profile?.displayName ?? user.username,
    language: user.profile?.language ?? DEFAULT_LOCALE,
    theme: user.profile?.theme ?? "system",
    onboarded: Boolean(user.profile?.onboardedAt),
    aiEnabled: user.profile?.aiEnabled ?? true,
    researchEnabled: user.profile?.researchEnabled ?? false,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new ForbiddenError();
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "UnauthorizedError";
  }
}

export async function startSession(userId: string) {
  const { token, tokenHash } = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { userId, tokenHash, expiresAt } });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Secure is driven by the deployment URL: a plain-HTTP LAN deployment must
    // still be able to log in, while an HTTPS deployment always gets Secure.
    secure: (process.env.APP_URL ?? "").startsWith("https://"),
    path: "/",
    expires: expiresAt,
  });
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { mustChangePassword: true } });
  if (account?.mustChangePassword) (await cookies()).set("nutricore_password_change", "1", { httpOnly: true, sameSite: "lax", path: "/", expires: expiresAt });

  // Opportunistic cleanup keeps the session table from growing unbounded.
  await prisma.session.deleteMany({ where: { userId, expiresAt: { lte: new Date() } } });
  return token;
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  store.delete(SESSION_COOKIE);
  store.delete("nutricore_password_change");
}

/**
 * Same-origin check for state-changing requests. Server Actions carry their own
 * origin validation, but route handlers do not, so every mutation calls this.
 */
export async function assertSameOrigin() {
  const headerList = await headers();
  const origin = headerList.get("origin");
  if (!origin) return; // Same-origin form posts and server-side calls send no Origin.

  const host = headerList.get("host");
  const allowed = new Set<string>();
  if (host) allowed.add(host);
  try {
    if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).host);
  } catch {
    /* APP_URL is validated at startup; ignore a malformed value here. */
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ForbiddenError("Invalid origin");
  }

  if (!allowed.has(originHost)) throw new ForbiddenError("Cross-origin request rejected");
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function resolveLocale(): Promise<Locale> {
  const user = await getSessionUser();
  if (user) return user.language;
  const cookieLocale = (await cookies()).get("NEXT_LOCALE")?.value;
  if (isLocale(cookieLocale)) return cookieLocale;
  return DEFAULT_LOCALE;
}
