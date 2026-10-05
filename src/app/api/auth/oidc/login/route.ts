import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { OIDC_FLOW_COOKIE, OIDC_FLOW_TTL_MS, authorizationUrl, createOidcFlow, encodeFlow, oidcConfig, oidcRedirectUri } from "@/lib/oidc";
import { securityCookieOptions } from "@/lib/auth";
import { discover } from "@/server/oidc";

/**
 * Starts a single sign-on: state, nonce and a PKCE verifier go into a
 * short-lived HTTP-only cookie, and the browser goes to the provider.
 */
export async function GET() {
  const { APP_URL } = env();
  const config = oidcConfig();
  if (!config) return NextResponse.redirect(new URL("/login", APP_URL));

  let endpoint: string;
  try {
    endpoint = (await discover(config)).authorization_endpoint;
  } catch (error) {
    logger.warn("Single sign-on provider unreachable", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.redirect(new URL("/login?error=ssoUnavailable", APP_URL));
  }

  const flow = createOidcFlow();
  const response = NextResponse.redirect(authorizationUrl(endpoint, config, flow, oidcRedirectUri(APP_URL)));
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(OIDC_FLOW_COOKIE, encodeFlow(flow), {
    ...securityCookieOptions(new Date(Date.now() + OIDC_FLOW_TTL_MS), APP_URL),
    path: "/api/auth/oidc",
  });
  return response;
}
