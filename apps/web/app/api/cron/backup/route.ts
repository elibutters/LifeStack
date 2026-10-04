import { NextResponse, type NextRequest } from "next/server";
import { runBackup } from "@/lib/backup";
import { cronAuthorized } from "@/lib/request";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runBackup()) });
  } catch (e) {
    console.error("backup failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
