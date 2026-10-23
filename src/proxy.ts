import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/server/session";

/**
 * Optimistic auth gate: anything except login, invite acceptance, health and
 * static assets needs a valid signed session. Real authorization (roles,
 * niche scope) is enforced again on the server in pages and actions.
 */
const PUBLIC_PREFIXES = ["/login", "/invite/", "/api/health", "/api/dialer/webhook"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const memberId = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (memberId) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|logo.png).*)"],
};
