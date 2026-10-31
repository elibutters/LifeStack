import "server-only";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { events } from "@lifestack/db";
import { db } from "./db";
import { ACTIVITY_KEY, STRAVA } from "./strava-map";

// Workouts as the API returns them. Distances are metres, times seconds, speeds metres per second.
export type Activity = {
  id: number | null;
  start: string;
  startLocal: string | null;
  sport: string;
  name: string | null;
  distanceM: number | null;
  movingS: number | null;
  elapsedS: number | null;
  elevationM: number | null;
  avgSpeedMs: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgWatts: number | null;
  kj: number | null;
  calories: number | null;
  effort: number | null;
};

const n = (v: unknown) => (typeof v === "number" ? v : null);

export async function loadActivity(id: number): Promise<Activity | null> {
  const [r] = await db().select().from(events).where(and(eq(events.source, STRAVA), eq(events.sourceId, `act:${id}`)));
  return r ? shape(r) : null;
}

function shape(r: typeof events.$inferSelect): Activity {
  const p = (r.payload ?? {}) as Record<string, unknown>;
  return {
    id: n(p.id),
    start: r.ts.toISOString(),
    startLocal: typeof p.startLocal === "string" ? p.startLocal : null,
    sport: r.valueText ?? "Workout",
    name: typeof p.name === "string" ? p.name : null,
    distanceM: n(p.distanceM),
    movingS: n(p.movingS),
    elapsedS: n(p.elapsedS),
    elevationM: n(p.elevationM),
    avgSpeedMs: n(p.avgSpeedMs),
    avgHr: n(p.avgHr),
    maxHr: n(p.maxHr),
    avgWatts: n(p.avgWatts),
    kj: n(p.kj),
    calories: n(p.calories),
    effort: n(p.effort),
  };
}

export async function loadActivities(q: { from?: Date; to?: Date; sport?: string; limit?: number } = {}): Promise<Activity[]> {
  const rows = await db()
    .select()
    .from(events)
    .where(and(eq(events.source, STRAVA), eq(events.key, ACTIVITY_KEY), q.from ? gte(events.ts, q.from) : undefined, q.to ? lt(events.ts, q.to) : undefined, q.sport ? eq(events.valueText, q.sport) : undefined))
    .orderBy(desc(events.ts))
    .limit(q.limit ?? 50);
  return rows.map(shape);
}

// Totals for a set of activities, overall and by sport.
export function totals(list: Activity[]) {
  const by = new Map<string, { sport: string; count: number; distanceM: number; movingS: number; elevationM: number }>();
  for (const a of list) {
    const t = by.get(a.sport) ?? { sport: a.sport, count: 0, distanceM: 0, movingS: 0, elevationM: 0 };
    t.count++;
    t.distanceM += a.distanceM ?? 0;
    t.movingS += a.movingS ?? 0;
    t.elevationM += a.elevationM ?? 0;
    by.set(a.sport, t);
  }
  const bySport = [...by.values()].sort((a, b) => b.movingS - a.movingS);
  return {
    count: list.length,
    distanceM: Math.round(bySport.reduce((s, t) => s + t.distanceM, 0)),
    movingS: bySport.reduce((s, t) => s + t.movingS, 0),
    elevationM: Math.round(bySport.reduce((s, t) => s + t.elevationM, 0)),
    bySport: bySport.map((t) => ({ ...t, distanceM: Math.round(t.distanceM), elevationM: Math.round(t.elevationM) })),
  };
}
