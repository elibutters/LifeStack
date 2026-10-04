import { NextResponse, type NextRequest } from "next/server";
import { syncEight } from "@/lib/eight";
import { cronAuthorized } from "@/lib/request";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await syncEight();
    return NextResponse.json({
      ok: true,
      connected: !!result,
      skipped: !!result && "skipped" in result,
      nights: result && "nights" in result ? result.nights : 0,
      backfill: result && "backfill" in result ? result.backfill : false,
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
