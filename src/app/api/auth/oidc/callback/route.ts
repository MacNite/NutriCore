import { NextResponse, type NextRequest } from "next/server";
import { cookies, headers } from "next/headers";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { clientAddress } from "@/lib/client-address";
import { safeEqual } from "@/lib/auth";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { OIDC_FLOW_COOKIE, decodeFlow, oidcConfig, oidcRedirectUri } from "@/lib/oidc";
import { OidcFlowError, accountFor, completeSignIn } from "@/server/oidc";
import { durableRateLimitOrFallback } from "@/server/durable-rate-limit";
import { startSession } from "@/server/session";
import { prisma } from "@/lib/db";

/**
 * Where the provider sends the browser back. Every failure ends on the login
 * page with a code it can explain; the detail goes to the log, not the page.
 */
export async function GET(request: NextRequest) {
  const { APP_URL, TRUSTED_PROXY_HOPS } = env();
  const fail = (code: string) => NextResponse.redirect(new URL(`/login?error=${code}`, APP_URL));

  const store = await cookies();
  const flow = decodeFlow(store.get(OIDC_FLOW_COOKIE)?.value);
  // Single use, whatever happens next.
  store.delete({ name: OIDC_FLOW_COOKIE, path: "/api/auth/oidc" });

  const config = oidcConfig();
  if (!config) return fail("ssoUnavailable");

  const key = `sso:${clientAddress(await headers(), TRUSTED_PROXY_HOPS)}`;
  const limit = await durableRateLimitOrFallback(key, RATE_LIMITS.sso.limit, RATE_LIMITS.sso.windowMs, rateLimit(key, RATE_LIMITS.sso.limit, RATE_LIMITS.sso.windowMs));
  if (!limit.allowed) return fail("rateLimited");

  const params = request.nextUrl.searchParams;
  const state = params.get("state");
  const code = params.get("code");
  if (params.get("error")) {
    logger.warn("Single sign-on refused by provider", { error: params.get("error") ?? "" });
    return fail("ssoFailed");
  }
  if (!flow || !state || !code || !safeEqual(state, flow.state)) {
    logger.warn("Single sign-on callback with missing or mismatched state");
    return fail("ssoFailed");
  }

  try {
    const identity = await completeSignIn(config, flow, code, oidcRedirectUri(APP_URL));
    const account = await accountFor(config, identity);
    await startSession(account.id, { oidcIdToken: identity.idToken });
    const profile = await prisma.userProfile.findUnique({ where: { userId: account.id }, select: { onboardedAt: true } });
    return NextResponse.redirect(new URL(profile?.onboardedAt ? "/" : "/onboarding", APP_URL));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (error instanceof OidcFlowError) {
      logger.warn("Single sign-on refused", { code: error.code, reason });
      return fail(error.code);
    }
    logger.error("Single sign-on failed", { reason });
    return fail("ssoFailed");
  }
}
