import { NextResponse, type NextRequest } from "next/server";
import { securityHeaders } from "@/lib/security-headers";

/**
 * Two jobs, both of which have to happen before a page renders.
 *
 * The password-change gate makes a temporary initial credential incapable of
 * reaching app pages or the export APIs. The cookie is set alongside the
 * session (see `startSession`) because middleware runs on the edge and cannot
 * reach Prisma.
 *
 * The security headers are here rather than in `next.config.ts` because the
 * Content-Security-Policy carries a per-request nonce, and a config-level
 * header is a constant. Next reads the nonce out of the CSP on the request
 * headers and applies it to the scripts it renders itself; `ThemeScript` reads
 * it from `x-nonce` and applies it to the one inline script we write.
 */
export function middleware(request: NextRequest) {
  /* 128 bits from the Web Crypto API, which is what the edge runtime has - no
     Node crypto here. A nonce only has to be unpredictable and unique per
     response. */
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");

  const headers = securityHeaders({
    nonce,
    https: (process.env.APP_URL ?? "").startsWith("https://"),
    development: process.env.NODE_ENV !== "production",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next looks for the nonce here to apply it to its own script tags.
  requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"]);

  const response = gate(request, requestHeaders);
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

/** The password-change gate, which decides what kind of response this is. */
function gate(request: NextRequest, requestHeaders: Headers) {
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });
  if (request.cookies.get("nutricore_password_change")?.value !== "1") return next();

  const { pathname } = request.nextUrl;
  const allowed = pathname === "/change-password" || pathname === "/login" || pathname.startsWith("/_next/");
  return allowed ? next() : NextResponse.redirect(new URL("/change-password", request.url));
}

/**
 * Everything except the health probe and static assets. The other API routes
 * stay in scope on purpose: an account that still owes a password change must
 * not be able to reach `/api/export/*` either, and every HTML response needs
 * its headers.
 */
export const config = {
  matcher: ["/((?!api/health|_next/static|_next/image|icon.svg|manifest.webmanifest|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
