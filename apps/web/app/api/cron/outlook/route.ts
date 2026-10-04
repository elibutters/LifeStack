import { NextResponse, type NextRequest } from "next/server";
import { syncOutlook } from "@/lib/outlook";
import { cronAuthorized } from "@/lib/request";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await syncOutlook();
    return NextResponse.json({
      ok: true,
      connected: !!result,
      skipped: !!result && "skipped" in result,
      events: result && "events" in result ? result.events : 0,
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
