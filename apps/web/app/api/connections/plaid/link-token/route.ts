import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isAuthed } from "@/lib/auth";
import { accessTokenFor } from "@/lib/finance";
import { appOrigin } from "@/lib/microsoft";
import { linkTokenCreate, plaidConfigured } from "@/lib/plaid";
import { crossSite } from "@/lib/request";

export const dynamic = "force-dynamic";

const Body = z.object({ kind: z.enum(["bank", "brokerage"]), itemId: z.string().min(1).optional() });

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (crossSite(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!plaidConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (process.env.VERCEL_ENV === "production" && !process.env.APP_URL) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  try {
    // Update mode (fixing an expired login) reuses the stored token; it never leaves the server.
    const accessToken = body.data.itemId ? await accessTokenFor(body.data.itemId) : undefined;
    if (body.data.itemId && !accessToken) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const { link_token } = await linkTokenCreate({
      kind: body.data.kind,
      accessToken: accessToken ?? undefined,
      origin: appOrigin(req.nextUrl.origin),
    });
    return NextResponse.json({ link_token });
  } catch (e) {
    console.error("plaid: link token failed", e instanceof Error ? e.message : "unknown error");
    return NextResponse.json({ error: "plaid_error" }, { status: 502 });
  }
}
