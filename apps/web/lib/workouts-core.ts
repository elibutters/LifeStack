// Workout maths for the Workouts screens and API. Pure: no database, no server-only imports, so it is tested on its own.
// Distances are metres, times seconds. Days are plain YYYY-MM-DD in the athlete's own timezone; weeks start on Monday.
export type Workout = {
  id: number | null;
  date: string; // local day of the start
  start: string; // ISO time
  sport: string;
  name: string | null;
  distanceM: number;
  movingS: number;
  elapsedS: number | null;
  elevationM: number;
  avgHr: number | null;
  calories: number | null;
  effort: number | null;
};

const DAY = 86_400_000;
const parse = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const addDaysStr = (d: string, n: number) => new Date(parse(d) + n * DAY).toISOString().slice(0, 10);
export const weekStart = (d: string) => addDaysStr(d, -((new Date(parse(d)).getUTCDay() + 6) % 7));

const RUN_SPORTS = new Set(["Run", "TrailRun", "VirtualRun"]);
export const isRun = (w: Pick<Workout, "sport">) => RUN_SPORTS.has(w.sport);
const MIN_PACE_M = 3219; // two miles; shorter runs say little about pace

export type Totals = { count: number; distanceM: number; movingS: number; elevationM: number; paceSecPerKm: number | null };

export function totalsOf(ws: Workout[]): Totals {
  let distanceM = 0, movingS = 0, elevationM = 0, runM = 0, runS = 0;
  for (const w of ws) {
    distanceM += w.distanceM; movingS += w.movingS; elevationM += w.elevationM;
    if (isRun(w)) { runM += w.distanceM; runS += w.movingS; }
  }
  return { count: ws.length, distanceM: Math.round(distanceM), movingS, elevationM: Math.round(elevationM), paceSecPerKm: runM > 0 ? Math.round(runS / (runM / 1000)) : null };
}

export function windowTotals(ws: Workout[], today: string) {
  const within = (from: string) => ws.filter((w) => w.date >= from && w.date <= today);
  return {
    last7: totalsOf(within(addDaysStr(today, -6))),
    last28: totalsOf(within(addDaysStr(today, -27))),
    ytd: totalsOf(within(`${today.slice(0, 4)}-01-01`)),
    all: totalsOf(ws),
  };
}

export type Week = Totals & { weekStart: string };

// The last `weeks` weeks ending with the current one, empty weeks included so a chart has no gaps.
export function weeklyBuckets(ws: Workout[], today: string, weeks: number): Week[] {
  const first = addDaysStr(weekStart(today), -7 * (weeks - 1));
  const by = new Map<string, Workout[]>();
  for (const w of ws) {
    const s = weekStart(w.date);
    if (s >= first) by.set(s, [...(by.get(s) ?? []), w]);
  }
  return Array.from({ length: weeks }, (_, i) => {
    const s = addDaysStr(first, 7 * i);
    return { weekStart: s, ...totalsOf(by.get(s) ?? []) };
  });
}

export type Cell = { date: string; count: number; distanceM: number };

export function heatmap(ws: Workout[], today: string, days: number): Cell[] {
  const by = new Map<string, Cell>();
  for (const w of ws) {
    const c = by.get(w.date) ?? { date: w.date, count: 0, distanceM: 0 };
    c.count++; c.distanceM += w.distanceM;
    by.set(w.date, c);
  }
  return Array.from({ length: days }, (_, i) => {
    const d = addDaysStr(today, -(days - 1 - i));
    const c = by.get(d);
    return { date: d, count: c?.count ?? 0, distanceM: Math.round(c?.distanceM ?? 0) };
  });
}

export type PacePoint = { date: string; paceSecPerKm: number; distanceM: number };

export function paceSeries(ws: Workout[]): PacePoint[] {
  return ws
    .filter((w) => isRun(w) && w.distanceM >= MIN_PACE_M && w.movingS > 0)
    .map((w) => ({ date: w.date, paceSecPerKm: Math.round(w.movingS / (w.distanceM / 1000)), distanceM: Math.round(w.distanceM) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export type Record_ = { id: number | null; date: string; name: string | null; distanceM: number; paceSecPerKm: number | null };

export function records(ws: Workout[]) {
  const pick = (w: Workout | undefined): Record_ | null =>
    w ? { id: w.id, date: w.date, name: w.name, distanceM: Math.round(w.distanceM), paceSecPerKm: w.distanceM > 0 && w.movingS > 0 ? Math.round(w.movingS / (w.distanceM / 1000)) : null } : null;
  const runs = ws.filter(isRun);
  const longest = [...runs].sort((a, b) => b.distanceM - a.distanceM)[0];
  const fastest = runs.filter((w) => w.distanceM >= MIN_PACE_M && w.movingS > 0).sort((a, b) => a.movingS / a.distanceM - b.movingS / b.distanceM)[0];
  const group = (key: (w: Workout) => string) => {
    const m = new Map<string, number>();
    for (const w of runs) m.set(key(w), (m.get(key(w)) ?? 0) + w.distanceM);
    const top = [...m].sort((a, b) => b[1] - a[1])[0];
    return top ? { period: top[0], distanceM: Math.round(top[1]) } : null;
  };
  return { longest: pick(longest), fastest: pick(fastest), biggestWeek: group((w) => weekStart(w.date)), biggestMonth: group((w) => w.date.slice(0, 7)) };
}

// Weeks in a row with at least one workout, counting back from the current week (or the one before it if this week has none yet).
export function streakWeeks(ws: Workout[], today: string): number {
  const weeks = new Set(ws.map((w) => weekStart(w.date)));
  let s = weekStart(today);
  if (!weeks.has(s)) s = addDaysStr(s, -7);
  let n = 0;
  while (weeks.has(s)) { n++; s = addDaysStr(s, -7); }
  return n;
}

export function sports(ws: Workout[]) {
  const m = new Map<string, Workout[]>();
  for (const w of ws) m.set(w.sport, [...(m.get(w.sport) ?? []), w]);
  return [...m].map(([sport, list]) => ({ sport, ...totalsOf(list) })).sort((a, b) => b.movingS - a.movingS);
}

export function overviewOf(ws: Workout[], today: string, weeks: number, recent: number) {
  const sorted = [...ws].sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
  return {
    today,
    totals: windowTotals(sorted, today),
    weeks: weeklyBuckets(sorted, today, weeks),
    heatmap: heatmap(sorted, today, 84),
    pace: paceSeries(sorted),
    records: records(sorted),
    streakWeeks: streakWeeks(sorted, today),
    sports: sports(sorted),
    recent: sorted.slice(0, recent),
  };
}
