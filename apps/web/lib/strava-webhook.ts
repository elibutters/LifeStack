import "server-only";
import { webhookToken } from "./strava";
import type { handleStravaEvent } from "./strava-sync";

export type StravaEvent = Parameters<typeof handleStravaEvent>[0];
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

// Strava's one-time check that this address is ours: it sends our verify token and expects the challenge back.
export function verifyChallenge(req: Request): Response {
  const p = new URL(req.url).searchParams;
  if (p.get("hub.mode") !== "subscribe" || p.get("hub.verify_token") !== webhookToken() || !p.get("hub.challenge")) return json({ error: "forbidden" }, 403);
  return json({ "hub.challenge": p.get("hub.challenge") });
}

// Reads an event body. Events are not signed, so the caller trusts nothing in it beyond which athlete it names.
export async function readEvent(req: Request): Promise<{ ok: true; event: StravaEvent } | { ok: false; res: Response }> {
  const text = await req.text();
  if (text.length > 4096) return { ok: false, res: json({ error: "too_large" }, 413) };
  try {
    const event = JSON.parse(text) as StravaEvent;
    if (!event || typeof event !== "object") throw new Error("not an object");
    return { ok: true, event };
  } catch {
    return { ok: false, res: json({ error: "invalid_json" }, 400) };
  }
}
