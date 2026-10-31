import "server-only";
import { loadActivities } from "./activities";
import { describeError } from "./errors";
import { linkActivity, sessionsOf } from "./goals";
import { afterResponse, notebookHook } from "./goals-notion";
import { matchSessions, type Actual } from "./strava-link-core";

const LOOKBACK_MS = 10 * 86_400_000;
const LOOKAHEAD_MS = 86_400_000;

// After a Strava sync: pair recent unlinked sessions with the activities that match them. A manual link or unlink is never overridden
// by this (linked sessions are skipped), though an unlinked session can be matched again later. Never throws.
export async function autoLinkRecent(now = new Date()): Promise<number> {
  try {
    const from = new Date(now.getTime() - LOOKBACK_MS), to = new Date(now.getTime() + LOOKAHEAD_MS);
    const all = await sessionsOf();
    const sessions = all.filter((s) => s.start >= from && s.start <= to);
    if (!sessions.length) return 0;
    const acts = (await loadActivities({ from, limit: 200 })).filter((a): a is typeof a & { id: number } => a.id !== null);
    const actuals: Actual[] = acts.map((a) => ({ id: a.id, name: a.name, sport: a.sport, distanceM: a.distanceM, movingS: a.movingS, avgHr: a.avgHr, start: a.start }));
    const linked = new Set(all.flatMap((s) => (s.actual ? [s.actual.id] : [])));
    let n = 0;
    for (const m of matchSessions(sessions, actuals, linked)) {
      const r = await linkActivity(m.sessionId, m.activityId);
      if (!r.ok) continue;
      n++;
      if (r.completed) afterResponse(() => notebookHook({ type: "done", session: r.session }));
    }
    return n;
  } catch (e) {
    console.error("strava-link: auto link failed", describeError(e));
    return 0;
  }
}
