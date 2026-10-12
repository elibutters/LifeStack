import { after, NextResponse } from "next/server";
import { describeError } from "@/lib/errors";
import { handleStravaEvent } from "@/lib/strava-sync";
import { readEvent, verifyChallenge } from "@/lib/strava-webhook";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = (req: Request) => verifyChallenge(req);

// Strava expects a quick 200; the work happens afterwards. handleStravaEvent only checks the athlete matches and then
// runs a normal sync, which reads the truth from Strava with our own token.
export async function POST(req: Request) {
  const read = await readEvent(req);
  if (!read.ok) return read.res;
  after(() => handleStravaEvent(read.event).catch((e) => console.error("strava: event failed", describeError(e))));
  return NextResponse.json({ ok: true });
}
