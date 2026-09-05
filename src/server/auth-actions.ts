"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { clientAddress } from "@/lib/client-address";
import { hashPassword, hashSessionToken, passwordProblem, verifyPassword } from "@/lib/auth";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { endSession, startSession } from "./session";
import { RegistrationClosedError, createSelfRegisteredUser } from "./registration";

export interface AuthState {
  error?: string;
  seconds?: number;
}

const credentials = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});

const registration = credentials.extend({
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/),
  displayName: z.string().trim().min(1).max(80),
});

async function clientKey() {
  return clientAddress(await headers(), env().TRUSTED_PROXY_HOPS);
}

export async function loginAction(_state: AuthState, formData: FormData): Promise<AuthState> {
  const limit = rateLimit(`login:${await clientKey()}`, RATE_LIMITS.login.limit, RATE_LIMITS.login.windowMs);
  if (!limit.allowed) return { error: "rateLimited", seconds: limit.retryAfterSeconds };

  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "invalidCredentials" };

  /* Per-account throttle, which unlike the address one cannot be sidestepped by
     changing where the request appears to come from - and is what actually
     bounds a distributed guessing run against one account.

     Keyed on a hash so the limiter's key space holds no addresses, and counted
     for every attempt on an account-shaped input whether or not the account
     exists, so that being throttled says nothing about which emails are
     registered. The reply is the same shape as the address limit above, which
     the login form already renders. */
  const accountLimit = rateLimit(`login-account:${hashSessionToken(parsed.data.email)}`, RATE_LIMITS.loginAccount.limit, RATE_LIMITS.loginAccount.windowMs);
  if (!accountLimit.allowed) return { error: "rateLimited", seconds: accountLimit.retryAfterSeconds };

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  // Always run a verification so a missing account and a wrong password take
  // comparable time and cannot be told apart by response timing.
  const hash = user?.passwordHash ?? "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000";
  const valid = await verifyPassword(hash, parsed.data.password);

  if (!user || !valid || !user.active) {
    logger.warn("Failed sign-in attempt", { email: "[redacted]" });
    return { error: "invalidCredentials" };
  }

  await startSession(user.id);
  const profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
  redirect(user.mustChangePassword ? "/change-password" : profile?.onboardedAt ? "/" : "/onboarding");
}

export async function registerAction(_state: AuthState, formData: FormData): Promise<AuthState> {
  const limit = rateLimit(`register:${await clientKey()}`, RATE_LIMITS.register.limit, RATE_LIMITS.register.windowMs);
  if (!limit.allowed) return { error: "rateLimited", seconds: limit.retryAfterSeconds };

  const parsed = registration.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    username: formData.get("username"),
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) return { error: "invalid" };

  const problem = passwordProblem(parsed.data.password);
  if (problem === "too-short") return { error: "tooShort" };
  if (problem === "too-common") return { error: "tooCommon" };

  const passwordHash = await hashPassword(parsed.data.password);

  let userId: string;
  try {
    const user = await createSelfRegisteredUser({
      email: parsed.data.email,
      username: parsed.data.username,
      passwordHash,
      displayName: parsed.data.displayName,
    });
    userId = user.id;
  } catch (error) {
    // The policy refused. Deliberately the same answer whether the instance is
    // already bootstrapped or registration is switched off outright: neither is
    // a fact a stranger needs.
    if (error instanceof RegistrationClosedError) return { error: "registrationClosed" };
    // Unique-constraint violations are the expected failure here.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = (error.meta?.target as string[] | undefined)?.join(",") ?? "";
      return { error: target.includes("username") ? "usernameTaken" : "emailTaken" };
    }
    throw error;
  }

  await startSession(userId);
  redirect("/onboarding");
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}
