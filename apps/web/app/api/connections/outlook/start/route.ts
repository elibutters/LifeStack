import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";
import { appOrigin, authorizeUrl, microsoftConfigured, newPkce, OAUTH_COOKIE, OAUTH_COOKIE_PATH } from "@/lib/microsoft";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const origin = appOrigin(req.nextUrl.origin);
  if (!microsoftConfigured()) return NextResponse.redirect(new URL("/settings?error=not_configured", origin));

  const state = randomBytes(16).toString("base64url");
  const { verifier, challenge } = newPkce();
  const res = NextResponse.redirect(authorizeUrl(origin, state, challenge));
  res.cookies.set(OAUTH_COOKIE, `${state}.${verifier}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: OAUTH_COOKIE_PATH,
    maxAge: 600,
  });
  return res;
}
