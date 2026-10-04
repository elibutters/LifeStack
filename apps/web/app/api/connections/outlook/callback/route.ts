import { describeError } from "@/lib/errors";
import { after, NextResponse, type NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";
import { appOrigin, exchangeCode, microsoftConfigured, OAUTH_COOKIE, OAUTH_COOKIE_PATH } from "@/lib/microsoft";
import { fetchAccount, saveConnection, syncOutlook } from "@/lib/outlook";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!microsoftConfigured()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const origin = appOrigin(req.nextUrl.origin);
  const done = (query: string) => {
    const res = NextResponse.redirect(new URL(`/settings?${query}`, origin));
    res.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    return res;
  };

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return done("error=denied");

  // The state in the URL must match the one this browser was given when it started.
  const [state, verifier] = (req.cookies.get(OAUTH_COOKIE)?.value ?? "").split(".");
  const code = params.get("code");
  if (!state || !verifier || !code || state !== params.get("state")) return done("error=state");

  try {
    const tokens = await exchangeCode(origin, code, verifier);
    if (!tokens.refresh_token) return done("error=exchange");
    await saveConnection(tokens.refresh_token, await fetchAccount(tokens.access_token));
  } catch (e) {
    console.error("outlook: connect failed", describeError(e));
    return done("error=exchange");
  }

  after(() => syncOutlook().catch(() => {}));
  return done("connected=1");
}
