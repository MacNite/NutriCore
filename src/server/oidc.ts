import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { registrationMode } from "@/lib/env";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import {
  SSO_ONLY_PASSWORD_HASH,
  baseUsername,
  provisionDecision,
  usernameCandidates,
  type OidcConfig,
  type OidcError,
  type OidcFlow,
} from "@/lib/oidc";
import { BOOTSTRAP_LOCK_KEY } from "./registration";

/**
 * The network half of single sign-on: discovery, the code exchange, ID token
 * verification and turning a verified identity into a NutriCore account.
 */

const discoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  jwks_uri: z.string().url(),
  userinfo_endpoint: z.string().url().optional(),
  end_session_endpoint: z.string().url().optional(),
});
export type Discovery = z.infer<typeof discoverySchema>;

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;
let discoveryCache: { issuer: string; at: number; value: Discovery } | undefined;
let jwksCache: { uri: string; set: ReturnType<typeof createRemoteJWKSet> } | undefined;

export class OidcFlowError extends Error {
  constructor(
    readonly code: OidcError,
    message: string,
  ) {
    super(message);
    this.name = "OidcFlowError";
  }
}

/** The provider's metadata, cached for an hour. */
export async function discover(config: OidcConfig): Promise<Discovery> {
  if (discoveryCache && discoveryCache.issuer === config.issuer && Date.now() - discoveryCache.at < DISCOVERY_TTL_MS)
    return discoveryCache.value;

  const url = new URL(".well-known/openid-configuration", config.issuer.endsWith("/") ? config.issuer : `${config.issuer}/`);
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  if (!response.ok) throw new OidcFlowError("ssoUnavailable", `Discovery answered ${response.status}`);
  const value = discoverySchema.parse(await response.json());
  // OIDC Discovery 4.3: the issuer in the document must be the one we asked.
  // A missing or extra trailing slash in the setting is forgiven; the
  // provider's own spelling is what ID tokens are then checked against.
  const bare = (issuer: string) => issuer.replace(/\/+$/, "");
  if (bare(value.issuer) !== bare(config.issuer))
    throw new OidcFlowError("ssoUnavailable", `Issuer mismatch: configured ${config.issuer}, provider says ${value.issuer}`);
  discoveryCache = { issuer: config.issuer, at: Date.now(), value };
  return value;
}

const tokenSchema = z.object({ id_token: z.string(), access_token: z.string().optional() });

const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().optional(),
  email_verified: z.union([z.boolean(), z.string()]).optional(),
  preferred_username: z.string().optional(),
  name: z.string().optional(),
});

export interface VerifiedIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  preferredUsername?: string;
  name?: string;
  idToken: string;
}

/** Exchanges the authorization code and verifies what comes back. */
export async function completeSignIn(config: OidcConfig, flow: OidcFlow, code: string, redirectUri: string): Promise<VerifiedIdentity> {
  const metadata = await discover(config);

  const basic = Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString("base64");
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: flow.verifier }),
  });
  if (!response.ok) throw new OidcFlowError("ssoFailed", `Token endpoint answered ${response.status}`);
  const tokens = tokenSchema.parse(await response.json());

  const payload = await verifyIdToken(config, metadata, tokens.id_token);
  if (payload.nonce !== flow.nonce) throw new OidcFlowError("ssoFailed", "ID token nonce mismatch");

  let claims = claimsSchema.parse(payload);
  // The email may only be released through userinfo, depending on the provider's
  // "include claims in id_token" setting.
  if (!claims.email && metadata.userinfo_endpoint && tokens.access_token) {
    const info = await fetch(metadata.userinfo_endpoint, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json" },
    });
    if (info.ok) {
      const extra = claimsSchema.parse(await info.json());
      // OIDC Core 5.3.2: userinfo `sub` must match the ID token's.
      if (extra.sub !== claims.sub) throw new OidcFlowError("ssoFailed", "userinfo subject mismatch");
      claims = { ...claims, ...extra };
    }
  }

  const email = claims.email?.trim().toLowerCase();
  if (!email || !z.email().safeParse(email).success) throw new OidcFlowError("ssoFailed", "Provider released no usable email address");

  return {
    subject: claims.sub,
    email,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    preferredUsername: claims.preferred_username,
    name: claims.name,
    idToken: tokens.id_token,
  };
}

/**
 * Asymmetric signatures are checked against the provider's JWKS. authentik
 * falls back to HS256 with the client secret when a provider has no signing
 * key selected, so that is accepted too - the secret is ours, which is what
 * makes it a valid check.
 */
async function verifyIdToken(config: OidcConfig, metadata: Discovery, idToken: string): Promise<JWTPayload> {
  const options = { issuer: metadata.issuer, audience: config.clientId, clockTolerance: 60 };
  try {
    const { alg } = decodeProtectedHeader(idToken);
    if (alg === "HS256" || alg === "HS384" || alg === "HS512") {
      const { payload } = await jwtVerify(idToken, new TextEncoder().encode(config.clientSecret), { ...options, algorithms: [alg] });
      return payload;
    }
    if (!jwksCache || jwksCache.uri !== metadata.jwks_uri)
      jwksCache = { uri: metadata.jwks_uri, set: createRemoteJWKSet(new URL(metadata.jwks_uri)) };
    const { payload } = await jwtVerify(idToken, jwksCache.set, {
      ...options,
      algorithms: ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"],
    });
    return payload;
  } catch (error) {
    if (error instanceof OidcFlowError) throw error;
    throw new OidcFlowError("ssoFailed", `ID token rejected: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The account a verified identity signs in as - linked, matched by email, or
 * created - or an `OidcFlowError` saying why there is none.
 *
 * Matching is by email, as configured in the provider, but only the first
 * time: the account is then bound to the provider's `sub`, so a later email
 * change in the provider cannot move the sign-in onto somebody else's account,
 * and an account already bound to another subject is never taken over.
 */
export async function accountFor(config: OidcConfig, identity: VerifiedIdentity): Promise<{ id: string }> {
  const linked = await prisma.user.findUnique({ where: { oidcSubject: identity.subject }, select: { id: true, active: true } });
  if (linked) {
    if (!linked.active) throw new OidcFlowError("ssoInactive", "Linked account is deactivated");
    return linked;
  }

  if (config.requireVerifiedEmail && !identity.emailVerified)
    throw new OidcFlowError("ssoUnverified", "Provider did not mark the email as verified");

  const existing = await prisma.user.findUnique({ where: { email: identity.email }, select: { id: true, active: true, oidcSubject: true } });
  if (existing) {
    if (existing.oidcSubject) throw new OidcFlowError("ssoConflict", "Account with this email is linked to another identity");
    if (!existing.active) throw new OidcFlowError("ssoInactive", "Account is deactivated");
    // Conditional on still being unlinked, so two racing first sign-ins cannot both bind.
    const bound = await prisma.user.updateMany({ where: { id: existing.id, oidcSubject: null }, data: { oidcSubject: identity.subject } });
    if (bound.count !== 1) throw new OidcFlowError("ssoConflict", "Account was linked concurrently");
    logger.info("Linked account to single sign-on identity", { userId: existing.id });
    return { id: existing.id };
  }

  const created = await provision(config, identity);
  if (!created) throw new OidcFlowError("ssoNoAccount", "No account for this email and automatic creation is off");
  logger.info("Created account from single sign-on", { userId: created.id });
  return created;
}

/** Creates the account under the same lock the bootstrap registration uses. */
async function provision(config: OidcConfig, identity: VerifiedIdentity) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`;

    const userCount = await tx.user.count();
    const invitation = await tx.userInvitation.findFirst({
      where: { email: identity.email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    const decision = provisionDecision({
      hasInvitation: Boolean(invitation),
      invitationRole: invitation?.role,
      userCount,
      registrationMode: registrationMode(),
      autoCreate: config.autoCreate,
    });
    if (!decision.create) return null;

    let username: string | undefined;
    for (const candidate of usernameCandidates(baseUsername(identity.preferredUsername, identity.email))) {
      if (!(await tx.user.findUnique({ where: { username: candidate }, select: { id: true } }))) {
        username = candidate;
        break;
      }
    }
    if (!username) throw new OidcFlowError("ssoFailed", "Could not find a free username");

    if (invitation) await tx.userInvitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });

    return tx.user.create({
      data: {
        email: identity.email,
        username,
        passwordHash: SSO_ONLY_PASSWORD_HASH,
        oidcSubject: identity.subject,
        role: decision.role,
        profile: {
          create: { displayName: (invitation?.name || identity.name || username).slice(0, 80), language: DEFAULT_LOCALE },
        },
      },
      select: { id: true },
    });
  });
}
