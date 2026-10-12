import { after, NextResponse, type NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";
import { describeError } from "@/lib/errors";
import { appOrigin, exchangeCode, OAUTH_COOKIE, OAUTH_COOKIE_PATH, stravaConfigured } from "@/lib/strava";
import { ensureWebhook, saveConnection, syncStrava } from "@/lib/strava-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!stravaConfigured()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const origin = appOrigin(req.nextUrl.origin);
  const done = (query: string) => {
    const res = NextResponse.redirect(new URL(`/connections?${query}`, origin));
    res.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    return res;
  };

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return done("error=strava_denied");
  // The state in the URL must match the one this browser was given when it started.
  const state = req.cookies.get(OAUTH_COOKIE)?.value;
  const code = params.get("code");
  if (!state || !code || state !== params.get("state")) return done("error=strava_state");
  // Strava lets the person untick permissions; without activity access there is nothing to sync.
  if (!(params.get("scope") ?? "").includes("activity:read")) return done("error=strava_scope");

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.athlete) return done("error=strava_exchange");
    const name = [tokens.athlete.firstname, tokens.athlete.lastname?.slice(0, 1) && `${tokens.athlete.lastname.slice(0, 1)}.`].filter(Boolean).join(" ") || null;
    await saveConnection(tokens.refresh_token, name, tokens.athlete.id);
  } catch (e) {
    console.error("strava: connect failed", describeError(e));
    return done("error=strava_exchange");
  }

  after(async () => {
    await ensureWebhook(origin).catch((e) => console.error("strava: live updates not enabled", describeError(e)));
    await syncStrava({ full: true }).catch(() => {});
  });
  return done("connected=strava");
}
