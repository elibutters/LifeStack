import { fmtMiles, fmtPace } from "./units";

// Pure rules for attaching a Strava activity to a planned goal session. No database, no network.
// A session and an activity belong together when the activity started close to the planned time and the sport fits the title.
export type Actual = { id: number; name: string | null; sport: string; distanceM: number | null; movingS: number | null; avgHr: number | null; start: string };
export type LinkSession = { id: string; title: string; start: Date; end: Date; durationMin: number; status: string; actual: { id: number } | null };

const BEFORE_MS = 2 * 3_600_000; // an activity may start up to this long before the planned start
const AFTER_MS = 3 * 3_600_000; // or this long after the planned end
export const COMPLETE_SHARE = 0.7; // an activity this share of the planned minutes counts the session as done

const RUN = ["Run", "TrailRun", "VirtualRun"];
const RIDE = ["Ride", "VirtualRide", "EBikeRide", "GravelRide", "MountainBikeRide"];
const GROUPS: { re: RegExp; sports: string[] }[] = [
  { re: /\b(run|jog|strides?|tempo|intervals?|fartlek|parkrun|race|5k|10k)\b/i, sports: RUN },
  { re: /\b(ride|bike|cycl\w*|spin)\b/i, sports: RIDE },
  { re: /\bswim\w*\b/i, sports: ["Swim"] },
  { re: /\b(walk|hike)\b/i, sports: ["Walk", "Hike"] },
  { re: /\b(lift\w*|strength|weights?|gym)\b/i, sports: ["WeightTraining", "Workout", "Crossfit"] },
  { re: /\byoga\b/i, sports: ["Yoga"] },
  { re: /\brow\w*\b/i, sports: ["Rowing", "VirtualRow"] },
];

// null means the title says nothing about the sport, so any sport may match.
export const sportsFor = (title: string): string[] | null => GROUPS.find((g) => g.re.test(title))?.sports ?? null;
export const sportFits = (title: string, sport: string) => (sportsFor(title) ?? [sport]).includes(sport);

export function matchesWindow(s: Pick<LinkSession, "start" | "end" | "title">, a: Pick<Actual, "start" | "sport">): boolean {
  const t = Date.parse(a.start);
  return t >= s.start.getTime() - BEFORE_MS && t <= s.end.getTime() + AFTER_MS && sportFits(s.title, a.sport);
}

// Each activity goes to at most one session and each session gets at most one activity; the closest starts are paired first.
// Sessions that already have a link, or were skipped, are left alone, as are activities that are already linked.
export function matchSessions(sessions: LinkSession[], activities: Actual[], linkedIds: Set<number>): { sessionId: string; activityId: number }[] {
  const pairs: { sessionId: string; activityId: number; diff: number }[] = [];
  for (const s of sessions) {
    if (s.actual || s.status === "skipped" || s.status === "replaced") continue;
    for (const a of activities) {
      if (linkedIds.has(a.id) || !matchesWindow(s, a)) continue;
      pairs.push({ sessionId: s.id, activityId: a.id, diff: Math.abs(Date.parse(a.start) - s.start.getTime()) });
    }
  }
  pairs.sort((x, y) => x.diff - y.diff || x.activityId - y.activityId);
  const usedS = new Set<string>(), usedA = new Set<number>(), out: { sessionId: string; activityId: number }[] = [];
  for (const p of pairs) {
    if (usedS.has(p.sessionId) || usedA.has(p.activityId)) continue;
    usedS.add(p.sessionId); usedA.add(p.activityId);
    out.push({ sessionId: p.sessionId, activityId: p.activityId });
  }
  return out;
}

// True when the activity is long enough to count the planned session as done.
export const completes = (plannedMin: number, movingS: number | null) => movingS != null && movingS / 60 >= plannedMin * COMPLETE_SHARE;

const clock = (s: number) => {
  const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

export const stravaUrl = (id: number) => `https://www.strava.com/activities/${id}`;

// One line for the calendar event and the goal: "Actual: 3.1 mi in 28:40, 9:15 /mi, avg HR 152 (Strava)".
export function actualLine(a: Actual): string {
  const parts: string[] = [];
  if (a.distanceM && a.movingS) {
    parts.push(`${fmtMiles(a.distanceM)} in ${clock(a.movingS)}`);
    if (RUN.includes(a.sport) && a.distanceM >= 800) parts.push(fmtPace(a.movingS / (a.distanceM / 1000)));
  } else if (a.movingS) parts.push(clock(a.movingS));
  else parts.push(a.name ?? a.sport);
  if (a.avgHr) parts.push(`avg HR ${Math.round(a.avgHr)}`);
  return `Actual: ${parts.join(", ")} (Strava)`;
}
