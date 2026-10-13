import { NextResponse, type NextRequest } from "next/server";
import { syncMail } from "@/lib/email";
import { syncOutlook } from "@/lib/outlook";
import { cronAuthorized } from "@/lib/request";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  try {
    const result = await syncOutlook();
    // Mail rides along on the same daily run; a mail failure never fails the calendar sync.
    // The function is capped at 60s, so mail only gets what the calendar left, stopping well before the cap.
    const mail = await syncMail(Math.max(0, 38_000 - (Date.now() - started))).catch(() => null);
    return NextResponse.json({
      mail: mail && "stored" in mail ? { stored: mail.stored, done: mail.done } : null,
      ok: true,
      connected: !!result,
      skipped: !!result && "skipped" in result,
      events: result && "events" in result ? result.events : 0,
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
