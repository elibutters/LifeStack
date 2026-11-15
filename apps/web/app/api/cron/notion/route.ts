import { NextResponse, type NextRequest } from "next/server";
import { syncNotionAuto } from "@/lib/notion-sync";
import { cronAuthorized } from "@/lib/request";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const r = await syncNotionAuto();
    return NextResponse.json({ ok: true, connected: !!r, skipped: !!r && "skipped" in r, pages: r && "pages" in r ? r.pages : 0, done: !!r && "done" in r && r.done });
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
