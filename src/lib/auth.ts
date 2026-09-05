import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";

/** OWASP-aligned Argon2id parameters. */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export const SESSION_COOKIE = "nutricore_session";
export const PASSWORD_CHANGE_COOKIE = "nutricore_password_change";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * True when the deployment is served over HTTPS, and so when cookies may carry
 * `Secure`.
 *
 * Driven by `APP_URL` because a self-hosted instance on a plain-HTTP LAN has to
 * be able to sign in at all, and a `Secure` cookie would never be sent to it.
 * `assertSecureDeployment` is what keeps that from silently becoming the wrong
 * answer for a public one.
 */
export const secureCookies = (appUrl = process.env.APP_URL) => (appUrl ?? "").startsWith("https://");

/**
 * One set of cookie options for every security-relevant cookie.
 *
 * The session cookie and the password-change gate used to be written with two
 * separately spelled-out option objects, and they had drifted: the gate cookie
 * was missing `secure` altogether, so on an HTTPS deployment it was the one
 * thing still travelling in the clear. Anything that is part of the security
 * model gets these, and gets them from here.
 */
export const securityCookieOptions = (expires: Date, appUrl = process.env.APP_URL) =>
  ({ httpOnly: true, sameSite: "lax", secure: secureCookies(appUrl), path: "/", expires }) as const;

export const hashPassword = (password: string) => argon2.hash(password, ARGON2_OPTIONS);

export async function verifyPassword(hash: string, password: string) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Opaque 256-bit session token. Only its SHA-256 hash is persisted, so a
 * database leak does not hand out live sessions.
 */
export function createSessionToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

export const hashSessionToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export const PASSWORD_MIN_LENGTH = 10;

/** Length-first policy; composition rules push users towards worse passwords. */
export function passwordProblem(password: string): "too-short" | "too-common" | null {
  if (password.length < PASSWORD_MIN_LENGTH) return "too-short";
  const normalized = password.toLowerCase();
  const common = ["password", "passwort", "12345678", "qwertzuiop", "qwertyuiop", "nutricore", "letmein"];
  if (common.some((entry) => normalized.includes(entry))) return "too-common";
  return null;
}
