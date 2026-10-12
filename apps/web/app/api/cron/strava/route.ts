import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/lib/request";
import { syncStrava } from "@/lib/strava-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await syncStrava();
    return NextResponse.json({ ok: true, connected: !!result, skipped: !!result && "skipped" in result, activities: result && "activities" in result ? result.activities : 0 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
