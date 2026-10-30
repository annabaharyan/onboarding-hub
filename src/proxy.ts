import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authEnabled, verifySessionToken } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  if (!authEnabled()) return NextResponse.next();
  const ok = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL("/login", request.url);
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except login, the cron endpoint (secured by CRON_SECRET), health check and static assets
  matcher: ["/((?!login|api/cron|api/health|_next/static|_next/image|favicon.ico).*)"],
};
