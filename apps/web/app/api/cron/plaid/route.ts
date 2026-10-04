import { NextResponse, type NextRequest } from "next/server";
import { syncAllItems } from "@/lib/finance";
import { plaidConfigured } from "@/lib/plaid";
import { cronAuthorized } from "@/lib/request";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily backstop in case a webhook was missed. Authenticates itself; see proxy.ts.
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!plaidConfigured()) return NextResponse.json({ ok: true, configured: false });
  const result = await syncAllItems();
  return NextResponse.json({ ok: result.failed === 0, ...result });
}
