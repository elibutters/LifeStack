import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { markNeedsLogin, syncItem } from "@/lib/finance";
import { plaidConfigured, verifyWebhook } from "@/lib/plaid";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Event = z.object({
  webhook_type: z.string(),
  webhook_code: z.string(),
  item_id: z.string().optional(),
  error: z.object({ error_code: z.string().nullish() }).nullish(),
});

const SYNC_ON = new Set([
  "TRANSACTIONS:SYNC_UPDATES_AVAILABLE",
  "TRANSACTIONS:INITIAL_UPDATE",
  "TRANSACTIONS:HISTORICAL_UPDATE",
  "TRANSACTIONS:DEFAULT_UPDATE",
  "HOLDINGS:DEFAULT_UPDATE",
  "INVESTMENTS_TRANSACTIONS:DEFAULT_UPDATE",
]);
const NEEDS_LOGIN_ON = new Set(["ITEM:PENDING_EXPIRATION", "ITEM:PENDING_DISCONNECT", "ITEM:USER_PERMISSION_REVOKED"]);

// Public path (see proxy.ts): the only thing that authenticates the caller is Plaid's signature,
// so anything that does not verify is rejected before the body is even parsed.
export async function POST(req: NextRequest) {
  if (!plaidConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const raw = await req.text();
  if (!(await verifyWebhook(raw, req.headers.get("plaid-verification")))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const ev = Event.safeParse(json);
  if (!ev.success || !ev.data.item_id) return NextResponse.json({ ok: true }); // nothing for us to do
  const itemId = ev.data.item_id;
  const code = `${ev.data.webhook_type}:${ev.data.webhook_code}`;

  if (code === "ITEM:LOGIN_REPAIRED") after(() => syncItem(itemId, { repaired: true }).catch(() => {}));
  else if (SYNC_ON.has(code)) after(() => syncItem(itemId).catch(() => {}));
  else if (NEEDS_LOGIN_ON.has(code) || (code === "ITEM:ERROR" && ev.data.error?.error_code === "ITEM_LOGIN_REQUIRED")) {
    after(() => markNeedsLogin(itemId).catch(() => {}));
  }
  return NextResponse.json({ ok: true });
}
