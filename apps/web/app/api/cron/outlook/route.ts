import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { syncOutlook } from "@/lib/outlook";

export const dynamic = "force-dynamic";

// Called by Vercel Cron, which sends `Authorization: Bearer $CRON_SECRET`. This path is exempt
// from the session gate in proxy.ts, so it must authenticate the caller itself and fail closed.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 32) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await syncOutlook();
    return NextResponse.json({ ok: true, connected: !!result, events: result?.events ?? 0 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
