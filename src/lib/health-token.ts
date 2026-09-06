import { randomBytes } from "node:crypto";
import { hashSessionToken } from "./auth";

/**
 * The shape of a health sync token, and the only place that knows it.
 *
 * A session cookie is opaque because nothing but this application ever sees it.
 * A sync token is different: it gets pasted into an Apple Shortcut, typed into
 * an Android app, and - sooner or later - committed to somebody's dotfiles. So
 * it carries a prefix. That costs nothing and buys two things: a person looking
 * at a config file can tell what the string is, and a secret scanner can be
 * taught one pattern that matches it.
 *
 * The entropy is the same 256 bits `createSessionToken` uses, and the stored
 * form is the same SHA-256. A fast hash is the right one here: the token is
 * random rather than chosen, so there is nothing to guess faster than the
 * keyspace, and every sync request has to look one up.
 */

export const HEALTH_TOKEN_PREFIX = "nch_";

/** 32 random bytes as base64url, which is 43 characters. */
const SECRET_LENGTH = 43;

const PATTERN = new RegExp(`^${HEALTH_TOKEN_PREFIX}[A-Za-z0-9_-]{${SECRET_LENGTH}}$`);

export function createHealthToken() {
  const token = `${HEALTH_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashHealthToken(token) };
}

export const hashHealthToken = (token: string) => hashSessionToken(token);

/** True for something that could be a token. Cheap enough to run before a query. */
export const looksLikeHealthToken = (value: string) => PATTERN.test(value);

/**
 * Pull the token out of an `Authorization` header.
 *
 * Returns null rather than throwing, and does not distinguish "no header" from
 * "wrong scheme" from "not token-shaped": every one of those ends as the same
 * 401, and a caller that could tell them apart would be a caller that could
 * probe the format.
 */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer[ \t]+(\S+)$/.exec(header.trim());
  if (!match) return null;
  return looksLikeHealthToken(match[1]) ? match[1] : null;
}
