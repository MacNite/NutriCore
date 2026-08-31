import { NextResponse, type NextRequest } from "next/server";

/** Cookie gate makes a temporary initial credential incapable of reaching app pages. */
export function middleware(request: NextRequest) {
  if (request.cookies.get("nutricore_password_change")?.value !== "1") return NextResponse.next();
  const allowed = request.nextUrl.pathname === "/change-password" || request.nextUrl.pathname === "/login" || request.nextUrl.pathname.startsWith("/_next/");
  if (allowed) return NextResponse.next();
  return NextResponse.redirect(new URL("/change-password", request.url));
}

export const config = { matcher: ["/((?!api/health|icon.svg|manifest.webmanifest).*)"] };
