import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isAuthed } from "@/lib/auth";
import { linkItem, syncItem } from "@/lib/finance";
import { plaidConfigured } from "@/lib/plaid";
import { crossSite } from "@/lib/request";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ public_token: z.string().min(1), kind: z.enum(["bank", "brokerage"]) });

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (crossSite(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!plaidConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  try {
    const itemId = await linkItem(body.data.kind, body.data.public_token);
    after(() => syncItem(itemId).catch(() => {}));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("plaid: link failed", e instanceof Error ? e.message : "unknown error");
    return NextResponse.json({ error: "plaid_error" }, { status: 502 });
  }
}
