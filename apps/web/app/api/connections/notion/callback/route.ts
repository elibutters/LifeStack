import { after, NextResponse, type NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";
import { describeError } from "@/lib/errors";
import { appOrigin, exchangeCode, notionConfigured, OAUTH_COOKIE, OAUTH_COOKIE_PATH } from "@/lib/notion";
import { saveConnection, syncNotion } from "@/lib/notion-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!notionConfigured()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const origin = appOrigin(req.nextUrl.origin);
  const done = (query: string) => {
    const res = NextResponse.redirect(new URL(`/connections?${query}`, origin));
    res.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    return res;
  };

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return done("error=notion_denied");
  // The state in the URL must match the one this browser was given when it started.
  const state = req.cookies.get(OAUTH_COOKIE)?.value;
  const code = params.get("code");
  if (!state || !code || state !== params.get("state")) return done("error=notion_state");

  try {
    const t = await exchangeCode(origin, code);
    await saveConnection({ access: t.access, refresh: t.refresh }, t.workspace);
  } catch (e) {
    console.error("notion: connect failed", describeError(e));
    return done("error=notion_exchange");
  }

  after(() => syncNotion().catch(() => {}));
  return done("connected=notion");
}
