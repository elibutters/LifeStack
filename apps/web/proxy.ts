import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// The app is on the public internet, so everything is behind the owner session
// except the login page, the health check and the assets a browser needs to install the PWA.
const PUBLIC = new Set(["/login", "/api/health", "/manifest.webmanifest", "/icon", "/apple-icon", "/sw.js"]);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.has(pathname)) return NextResponse.next();

  const secret = process.env.SESSION_SECRET;
  if (secret && (await verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret))) {
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
