/**
 * Single sign-on through an OpenID Connect provider - written against
 * authentik, but nothing here is authentik-specific: any provider that
 * publishes `/.well-known/openid-configuration`, issues signed ID tokens and
 * supports the authorization-code flow with PKCE works the same way.
 *
 * Everything in this module is pure so that it can be tested without a
 * provider. The network half lives in `src/server/oidc.ts`.
 */

import { createHash, randomBytes } from "node:crypto";
import type { OidcConfig } from "./oidc-config";

export { authConfigurationProblems, oidcConfig, passwordLoginEnabled, type OidcConfig } from "./oidc-config";

/** The cookie that carries state, nonce and PKCE verifier across the redirect. */
export const OIDC_FLOW_COOKIE = "nutricore_oidc";
export const OIDC_FLOW_TTL_MS = 10 * 60 * 1000;

export interface OidcFlow {
  state: string;
  nonce: string;
  verifier: string;
}

const random = () => randomBytes(32).toString("base64url");

export function createOidcFlow(): OidcFlow {
  return { state: random(), nonce: random(), verifier: random() };
}

/** RFC 7636 S256 challenge. */
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export const encodeFlow = (flow: OidcFlow) => Buffer.from(JSON.stringify(flow)).toString("base64url");

export function decodeFlow(value: string | undefined): OidcFlow | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed?.state === "string" && typeof parsed?.nonce === "string" && typeof parsed?.verifier === "string")
      return { state: parsed.state, nonce: parsed.nonce, verifier: parsed.verifier };
  } catch {
    /* fall through */
  }
  return null;
}

/** Where the provider sends the browser back to. Must be registered with it. */
export const oidcRedirectUri = (appUrl: string) => new URL("/api/auth/oidc/callback", appUrl).toString();

/** Where the provider sends the browser after single logout. */
export const postLogoutRedirectUri = (appUrl: string) => new URL("/login", appUrl).toString();

export function authorizationUrl(endpoint: string, config: OidcConfig, flow: OidcFlow, redirectUri: string) {
  const url = new URL(endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", config.scopes);
  url.searchParams.set("state", flow.state);
  url.searchParams.set("nonce", flow.nonce);
  url.searchParams.set("code_challenge", pkceChallenge(flow.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function endSessionUrl(endpoint: string, config: OidcConfig, idToken: string | null, redirectUri: string) {
  const url = new URL(endpoint);
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("post_logout_redirect_uri", redirectUri);
  return url.toString();
}

/**
 * A username in NutriCore's alphabet (`[a-zA-Z0-9._-]{3,40}`) from whatever
 * the provider offers, preferring its own username, then the email's local
 * part. At most 31 characters, so the longest suffix `usernameCandidates`
 * adds still fits. Uniqueness is the caller's job.
 */
export function baseUsername(preferred: string | undefined, email: string): string {
  const clean = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "")
      .slice(0, 31);
  let name = clean(preferred ?? "");
  if (name.length < 3) name = clean(email.split("@")[0] ?? "");
  if (name.length < 3) name = `user${name}`.padEnd(3, "0");
  return name;
}

/** The base name first, then numbered variants - all within the 40-character limit. */
export function* usernameCandidates(base: string, attempts = 20): Generator<string> {
  yield base;
  for (let i = 2; i <= attempts; i++) yield `${base}-${i}`;
  yield `${base}-${randomBytes(4).toString("hex")}`;
}

/**
 * The password hash an SSO-created account is given. It is not a valid
 * Argon2 hash, so `verifyPassword` rejects every password against it: the
 * account can only sign in through the provider until an administrator sets
 * a password.
 */
export const SSO_ONLY_PASSWORD_HASH = "!sso-only";

/**
 * What to do with a verified sign-in whose subject and email match no linked
 * account. Kept pure so the policy reads in one place.
 *
 * - an open invitation for the email is honoured, with its role;
 * - an instance with no account at all lets the first SSO user become its
 *   administrator, exactly as the first password registration would;
 * - otherwise `OIDC_AUTO_CREATE` decides.
 */
export type ProvisionDecision = { create: true; role: "USER" | "ADMIN"; viaInvitation: boolean } | { create: false };

export function provisionDecision(input: {
  hasInvitation: boolean;
  invitationRole?: "USER" | "ADMIN";
  userCount: number;
  registrationMode: "bootstrap" | "open" | "disabled";
  autoCreate: boolean;
}): ProvisionDecision {
  if (input.hasInvitation) return { create: true, role: input.invitationRole ?? "USER", viaInvitation: true };
  if (input.userCount === 0) return input.registrationMode === "disabled" ? { create: false } : { create: true, role: "ADMIN", viaInvitation: false };
  if (input.autoCreate) return { create: true, role: "USER", viaInvitation: false };
  return { create: false };
}

/** The error codes the login page knows how to explain. */
export const OIDC_ERRORS = ["ssoFailed", "ssoNoAccount", "ssoUnverified", "ssoInactive", "ssoConflict", "ssoUnavailable"] as const;
export type OidcError = (typeof OIDC_ERRORS)[number];
export const isOidcError = (value: unknown): value is OidcError => OIDC_ERRORS.includes(value as OidcError);
