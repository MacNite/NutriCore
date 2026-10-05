/**
 * Single sign-on settings. Free of Node-only imports so the instrumentation
 * hook, which is also compiled for the edge runtime, can read them.
 */

const readBool = (value: string | undefined, fallback: boolean) =>
  value === undefined || value.trim() === "" ? fallback : value.trim() === "true" || value.trim() === "1";

export interface OidcConfig {
  /** Issuer exactly as the provider states it, trailing slash and all. */
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  /** What the sign-in button calls the provider. */
  providerName: string;
  /** Create an account on first sign-in when no account has the email. */
  autoCreate: boolean;
  /** Refuse an email the provider does not vouch for. */
  requireVerifiedEmail: boolean;
  /** End the provider's session on sign-out as well (RP-initiated logout). */
  singleLogout: boolean;
}

/**
 * The OIDC settings, or null when single sign-on is not configured.
 *
 * Read on its own rather than through `env()` for the same reason as
 * `registrationMode()`: the login page has to be able to answer "is SSO on?"
 * without every other setting being valid. A half-configured provider counts
 * as off - with a warning from `authConfigurationProblems` - rather than as a
 * button that fails on click.
 */
export function oidcConfig(source: Record<string, string | undefined> = process.env): OidcConfig | null {
  if (!readBool(source.OIDC_ENABLED, false)) return null;
  const issuer = source.OIDC_ISSUER?.trim();
  const clientId = source.OIDC_CLIENT_ID?.trim();
  const clientSecret = source.OIDC_CLIENT_SECRET?.trim();
  if (!issuer || !clientId || !clientSecret) return null;
  try {
    new URL(issuer);
  } catch {
    return null;
  }
  return {
    issuer,
    clientId,
    clientSecret,
    scopes: source.OIDC_SCOPES?.trim() || "openid email profile",
    providerName: source.OIDC_PROVIDER_NAME?.trim() || "authentik",
    autoCreate: readBool(source.OIDC_AUTO_CREATE, false),
    requireVerifiedEmail: readBool(source.OIDC_REQUIRE_VERIFIED_EMAIL, true),
    singleLogout: readBool(source.OIDC_SINGLE_LOGOUT, true),
  };
}

/**
 * Whether the email + password form is offered.
 *
 * `AUTH_PASSWORD_LOGIN=false` turns it off - but only when single sign-on is
 * actually configured. Without a working provider that switch would leave
 * nobody able to sign in, so it is ignored (and reported) instead. Even when
 * it is honoured, administrators keep a break-glass password sign-in at
 * `/login?local=1` for the day the provider is down.
 */
export function passwordLoginEnabled(source: Record<string, string | undefined> = process.env): boolean {
  if (readBool(source.AUTH_PASSWORD_LOGIN, true)) return true;
  return oidcConfig(source) === null;
}

/** Start-up warnings about the sign-in configuration. Never throws. */
export function authConfigurationProblems(source: Record<string, string | undefined> = process.env): string[] {
  const problems: string[] = [];
  const wantsOidc = readBool(source.OIDC_ENABLED, false);
  if (wantsOidc && !oidcConfig(source))
    problems.push("OIDC_ENABLED is true but OIDC_ISSUER, OIDC_CLIENT_ID or OIDC_CLIENT_SECRET is missing or invalid; single sign-on is off.");
  if (!readBool(source.AUTH_PASSWORD_LOGIN, true) && !oidcConfig(source))
    problems.push("AUTH_PASSWORD_LOGIN is false but single sign-on is not configured; password sign-in stays enabled so the instance cannot lock everyone out.");
  return problems;
}
