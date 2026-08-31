import { NextResponse, type NextRequest } from "next/server";

/**
 * Cookie gate that makes a temporary initial credential incapable of reaching
 * app pages or the export APIs. The cookie is set alongside the session (see
 * `startSession`) because middleware runs on the edge and cannot reach Prisma.
 */
export function middleware(request: NextRequest) {
  if (request.cookies.get("nutricore_password_change")?.value !== "1") return NextResponse.next();
  const { pathname } = request.nextUrl;
  const allowed = pathname === "/change-password" || pathname === "/login" || pathname.startsWith("/_next/");
  if (allowed) return NextResponse.next();
  return NextResponse.redirect(new URL("/change-password", request.url));
}

/**
 * Everything except the health probe and static assets. The other API routes
 * stay in scope on purpose: an account that still owes a password change must
 * not be able to reach `/api/export/*` either.
 */
export const config = {
  matcher: ["/((?!api/health|_next/static|_next/image|icon.svg|manifest.webmanifest|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
