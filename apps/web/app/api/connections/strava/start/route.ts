import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";
import { appOrigin, authorizeUrl, OAUTH_COOKIE, OAUTH_COOKIE_PATH, stravaConfigured } from "@/lib/strava";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Only a click on this site or a typed address may start a sign-in, not another website.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const origin = appOrigin(req.nextUrl.origin);
  if (!stravaConfigured()) return NextResponse.redirect(new URL("/connections?error=not_configured", origin));

  const state = randomBytes(16).toString("base64url");
  const res = NextResponse.redirect(authorizeUrl(origin, state));
  res.cookies.set(OAUTH_COOKIE, state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: OAUTH_COOKIE_PATH, maxAge: 600 });
  return res;
}
