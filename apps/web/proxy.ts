import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionKey, verifySession } from "@/lib/session";

// The app is on the public internet, so everything is behind the owner session except the
// login page, the health check, the assets a browser needs to install the PWA, /api/cron/ (handlers check a
// shared secret themselves, since Vercel Cron cannot hold a session) and the Plaid webhook (which
// verifies Plaid's signature).
const PUBLIC = new Set([
  "/login",
  "/api/health",
  "/manifest.webmanifest",
  "/icon",
  "/apple-icon",
  "/sw.js",
  "/offline.html",
  "/api/webhooks/plaid", // checks Plaid's signature itself
]);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.has(pathname) || pathname.startsWith("/api/cron/")) return NextResponse.next();

  const key = sessionKey();
  if (key && (await verifySession(req.cookies.get(SESSION_COOKIE)?.value, key))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
