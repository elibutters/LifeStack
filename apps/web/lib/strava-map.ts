import { z } from "zod";

// Strava activities as rows in the shared events table: domain "activity", one row per activity,
// source_id "act:<id>" so re-running a sync updates in place. No GPS track is stored.
export const STRAVA = "strava";
export const ACTIVITY_KEY = "activity.workout";

const num = z.number().nullish();
const Activity = z.object({
  id: z.number().int(),
  name: z.string().nullish(),
  sport_type: z.string().nullish(),
  type: z.string().nullish(),
  start_date: z.string(),
  start_date_local: z.string().nullish(),
  timezone: z.string().nullish(),
  distance: num,
  moving_time: num,
  elapsed_time: num,
  total_elevation_gain: num,
  average_speed: num,
  max_speed: num,
  average_heartrate: num,
  max_heartrate: num,
  average_watts: num,
  weighted_average_watts: num,
  kilojoules: num,
  average_cadence: num,
  calories: num,
  suffer_score: num, // Relative Effort; Strava only sends it for Premium athletes
  trainer: z.boolean().nullish(),
  commute: z.boolean().nullish(),
  manual: z.boolean().nullish(),
  private: z.boolean().nullish(),
  device_name: z.string().nullish(),
});

export type ActivityRow = {
  ts: Date;
  domain: "activity";
  key: typeof ACTIVITY_KEY;
  valueNum: number | null;
  valueText: string;
  payload: Record<string, unknown>;
  source: typeof STRAVA;
  sourceId: string;
};

export const sourceIdOf = (id: number) => `act:${id}`;

const compact = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

export function toRow(raw: unknown): { kind: "row"; row: ActivityRow } | { kind: "invalid"; id?: number } {
  const parsed = Activity.safeParse(raw);
  if (!parsed.success) {
    const id = (raw as { id?: unknown } | null)?.id;
    return { kind: "invalid", id: typeof id === "number" ? id : undefined };
  }
  const a = parsed.data;
  const ts = new Date(a.start_date);
  if (Number.isNaN(ts.getTime())) return { kind: "invalid", id: a.id };
  return {
    kind: "row",
    row: {
      ts,
      domain: "activity",
      key: ACTIVITY_KEY,
      valueNum: a.moving_time ?? null, // seconds moving
      valueText: a.sport_type ?? a.type ?? "Workout",
      payload: compact({
        id: a.id,
        name: a.name,
        distanceM: a.distance,
        movingS: a.moving_time,
        elapsedS: a.elapsed_time,
        elevationM: a.total_elevation_gain,
        avgSpeedMs: a.average_speed,
        maxSpeedMs: a.max_speed,
        avgHr: a.average_heartrate,
        maxHr: a.max_heartrate,
        avgWatts: a.average_watts,
        weightedWatts: a.weighted_average_watts,
        kj: a.kilojoules,
        cadence: a.average_cadence,
        calories: a.calories,
        effort: a.suffer_score,
        trainer: a.trainer,
        commute: a.commute,
        manual: a.manual,
        private: a.private,
        device: a.device_name,
        startLocal: a.start_date_local,
        timezone: a.timezone,
      }),
      source: STRAVA,
      sourceId: sourceIdOf(a.id),
    },
  };
}
