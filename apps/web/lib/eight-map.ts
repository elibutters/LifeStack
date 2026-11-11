import { z } from "zod";

export const EIGHT = "eight";

// A finished night can sit for a quarter hour. A night Eight Sleep is still scoring is refreshed
// sooner, because that first number is replaced once scoring finishes.
export const EIGHT_FRESH_MS = 15 * 60 * 1000;
export const EIGHT_PROCESSING_FRESH_MS = 5 * 60 * 1000;
export const EIGHT_RETRY_MS = 2 * 60 * 1000;

// Bump when a sync should walk history again so nights saved under an older mapper pick up new fields.
export const EIGHT_CAPTURE = 2;

export function eightSyncDue(input: {
  authFailed: boolean;
  backfillDone: boolean;
  ageMs: number;
  hasError: boolean;
  processing: boolean;
  captureStale: boolean;
}): boolean {
  if (input.authFailed) return false;
  if (input.hasError && input.ageMs < EIGHT_RETRY_MS) return false;
  if (input.captureStale) return true;
  if (input.backfillDone && input.ageMs < EIGHT_FRESH_MS && (input.ageMs < EIGHT_PROCESSING_FRESH_MS || !input.processing)) return false;
  return true;
}

const Score = z.object({
  score: z.number().optional(),
  current: z.number().optional(),
  average: z.number().optional(),
});

const Session = z.object({
  id: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  stages: z.array(z.object({ stage: z.string(), duration: z.number() })).optional(),
});

export const SleepDay = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  score: z.number().optional(),
  presenceStart: z.string().optional(),
  presenceEnd: z.string().optional(),
  presenceDuration: z.number().optional(),
  sleepDuration: z.number().optional(),
  lightDuration: z.number().optional(),
  deepDuration: z.number().optional(),
  remDuration: z.number().optional(),
  tnt: z.number().optional(),
  processing: z.boolean().optional(),
  sleepQualityScore: z
    .object({
      hrv: Score.optional(),
      respiratoryRate: Score.optional(),
      tempBedC: z.object({ average: z.number().optional() }).optional(),
      tempRoomC: z.object({ average: z.number().optional() }).optional(),
    })
    .optional(),
  sleepRoutineScore: z
    .object({
      latencyAsleepSeconds: z.object({ score: z.number().optional() }).optional(),
    })
    .optional(),
  sessions: z.array(Session).optional(),
});

export type SleepDay = z.infer<typeof SleepDay>;

export type NightPayload = {
  day: string;
  score?: number;
  presenceStart?: string;
  presenceEnd?: string;
  presenceMin?: number;
  sleepMin?: number;
  lightMin?: number;
  deepMin?: number;
  remMin?: number;
  awakeMin?: number;
  tnt?: number;
  processing?: boolean;
  hrv?: number;
  hrAvg?: number;
  respiratoryAvg?: number;
  tempBedC?: number;
  tempRoomC?: number;
  bedStart?: string;
  bedEnd?: string;
  qualityScore?: number;
  routineScore?: number;
  sleepDebtMin?: number;
  baselineSleepMin?: number;
  latencyAsleepMin?: number;
  latencyOutMin?: number;
  bedtimeConsistency?: number;
  sleepStartConsistency?: number;
  wakeupConsistency?: number;
  snoreMin?: number;
  heavySnoreMin?: number;
  snorePct?: number;
  heavySnorePct?: number;
  snoreReductionPct?: number;
  wasoMin?: number;
  wakeupCount?: number;
  awakeBeforeMin?: number;
  awakeBetweenMin?: number;
  awakeAfterMin?: number;
  outMin?: number;
  elevationMin?: number;
  chronoClass?: string;
  socialJetlagMin?: number;
  sessions?: { id?: string; start?: string; end?: string; stages?: { stage: string; durationMin: number }[] }[];
};

// The rest of the Eight Sleep day, including per-minute series. Kept off the night row so the sleep page does not load it.
export type TracePayload = {
  day: string;
  detail: Record<string, unknown>;
  series: { id?: string; series: Record<string, unknown> }[];
};

export type EventRow = {
  ts: Date;
  domain: "sleep";
  key: string;
  valueNum?: number;
  payload: NightPayload | TracePayload | Record<string, never>;
  source: typeof EIGHT;
  sourceId: string;
};

function mins(seconds: number | undefined): number | undefined {
  if (seconds == null || !Number.isFinite(seconds)) return undefined;
  return Math.round(seconds / 60);
}

function instant(iso: string | undefined, fallback: Date): Date {
  if (!iso) return fallback;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function durationMs(s: { startTime?: string; endTime?: string }): number {
  const a = s.startTime ? Date.parse(s.startTime) : NaN;
  const b = s.endTime ? Date.parse(s.endTime) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return b - a;
}

function mainSession(day: SleepDay) {
  const list = day.sessions ?? [];
  if (list.length === 0) return null;
  return list.reduce((best, s) => (durationMs(s) > durationMs(best) ? s : best));
}

export function hasSleep(day: SleepDay): boolean {
  return day.score != null || day.sleepDuration != null || !!day.presenceStart || (day.sessions?.length ?? 0) > 0;
}

export function payloadFromDay(day: SleepDay): NightPayload {
  const main = mainSession(day);
  const presenceMin = mins(day.presenceDuration);
  const sleepMin = mins(day.sleepDuration);
  const q = day.sleepQualityScore;
  const payload: NightPayload = { day: day.day };
  if (day.score != null) payload.score = day.score;
  if (day.presenceStart) payload.presenceStart = day.presenceStart;
  if (day.presenceEnd) payload.presenceEnd = day.presenceEnd;
  if (presenceMin != null) payload.presenceMin = presenceMin;
  if (sleepMin != null) payload.sleepMin = sleepMin;
  const light = mins(day.lightDuration);
  const deep = mins(day.deepDuration);
  const rem = mins(day.remDuration);
  if (light != null) payload.lightMin = light;
  if (deep != null) payload.deepMin = deep;
  if (rem != null) payload.remMin = rem;
  if (presenceMin != null && sleepMin != null && presenceMin >= sleepMin) payload.awakeMin = presenceMin - sleepMin;
  if (day.tnt != null) payload.tnt = day.tnt;
  if (day.processing) payload.processing = true;
  const hrv = q?.hrv?.current ?? q?.hrv?.average;
  const resp = q?.respiratoryRate?.current ?? q?.respiratoryRate?.average;
  if (hrv != null) payload.hrv = hrv;
  if (resp != null) payload.respiratoryAvg = resp;
  if (q?.tempBedC?.average != null) payload.tempBedC = q.tempBedC.average;
  if (q?.tempRoomC?.average != null) payload.tempRoomC = q.tempRoomC.average;
  if (main?.startTime) payload.bedStart = main.startTime;
  if (main?.endTime) payload.bedEnd = main.endTime;
  if (day.sessions?.length) {
    payload.sessions = day.sessions.map((s) => ({
      ...(s.id ? { id: s.id } : {}),
      ...(s.startTime ? { start: s.startTime } : {}),
      ...(s.endTime ? { end: s.endTime } : {}),
      ...(s.stages?.length
        ? { stages: s.stages.map((st) => ({ stage: st.stage, durationMin: mins(st.duration) ?? 0 })) }
        : {}),
    }));
  }
  return payload;
}

export function rowsFromDay(day: SleepDay, startOfDay: (ymd: string) => Date): EventRow[] {
  if (!hasSleep(day)) return [];
  const payload = payloadFromDay(day);
  const ts = instant(payload.bedEnd ?? payload.presenceEnd ?? payload.bedStart ?? payload.presenceStart, startOfDay(day.day));
  const rows: EventRow[] = [
    {
      ts,
      domain: "sleep",
      key: "sleep.night",
      valueNum: payload.score,
      payload,
      source: EIGHT,
      sourceId: `night:${day.day}`,
    },
  ];
  if (payload.score != null) {
    rows.push({
      ts,
      domain: "sleep",
      key: "sleep.score",
      valueNum: payload.score,
      payload: {},
      source: EIGHT,
      sourceId: `score:${day.day}`,
    });
  }
  if (payload.sleepMin != null) {
    rows.push({
      ts,
      domain: "sleep",
      key: "sleep.duration_min",
      valueNum: payload.sleepMin,
      payload: {},
      source: EIGHT,
      sourceId: `dur:${day.day}`,
    });
  }
  return rows;
}

function isNight(payload: EventRow["payload"]): payload is NightPayload {
  return "day" in payload && typeof payload.day === "string" && !("detail" in payload);
}

function asObj(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function numAt(root: unknown, ...path: string[]): number | undefined {
  let cur: unknown = root;
  for (const key of path) {
    const o = asObj(cur);
    if (!o) return undefined;
    cur = o[key];
  }
  return typeof cur === "number" && Number.isFinite(cur) ? cur : undefined;
}

function strAt(root: unknown, ...path: string[]): string | undefined {
  let cur: unknown = root;
  for (const key of path) {
    const o = asObj(cur);
    if (!o) return undefined;
    cur = o[key];
  }
  return typeof cur === "string" && cur.length > 0 ? cur : undefined;
}

function seriesMean(series: unknown): number | undefined {
  if (!Array.isArray(series)) return undefined;
  const values = series.flatMap((point) => (Array.isArray(point) && typeof point[1] === "number" && Number.isFinite(point[1]) ? [point[1]] : []));
  if (values.length === 0) return undefined;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

function longestRawSession(raw: unknown): Record<string, unknown> | undefined {
  const list = asObj(raw)?.sessions;
  if (!Array.isArray(list)) return undefined;
  let best: Record<string, unknown> | undefined;
  let bestMs = -1;
  for (const item of list) {
    const session = asObj(item);
    if (!session) continue;
    const fromTimes = durationMs({ startTime: strAt(session, "startTime"), endTime: strAt(session, "endTime") });
    const duration = typeof session.duration === "number" ? session.duration * 1000 : 0;
    const ms = Math.max(fromTimes, duration);
    if (!best || ms > bestMs) {
      best = session;
      bestMs = ms;
    }
  }
  return best;
}

function omitKey(value: unknown, key: string): unknown {
  if (Array.isArray(value)) return value.map((item) => omitKey(item, key));
  const o = asObj(value);
  if (!o) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === key) continue;
    out[k] = omitKey(v, key);
  }
  return out;
}

function metricsFromRaw(raw: unknown): Partial<NightPayload> {
  const session = longestRawSession(raw);
  const summary = asObj(session?.stageSummary);
  const series = asObj(session?.timeseries);
  const metrics: Partial<NightPayload> = {};
  const putNum = (key: keyof NightPayload, value: number | undefined) => {
    if (value != null) (metrics as Record<string, number>)[key] = value;
  };
  putNum("hrAvg", numAt(raw, "sleepQualityScore", "heartRate", "current"));
  putNum("qualityScore", numAt(raw, "sleepQualityScore", "total"));
  putNum("routineScore", numAt(raw, "sleepRoutineScore", "total"));
  putNum("sleepDebtMin", mins(numAt(raw, "sleepQualityScore", "sleepDebt", "dailySleepDebtSeconds")));
  putNum("baselineSleepMin", mins(numAt(raw, "sleepQualityScore", "sleepDebt", "baselineSleepDurationSeconds")));
  putNum("latencyAsleepMin", mins(numAt(raw, "sleepRoutineScore", "latencyAsleepSeconds", "current")));
  putNum("latencyOutMin", mins(numAt(raw, "sleepRoutineScore", "latencyOutSeconds", "current")));
  putNum("bedtimeConsistency", numAt(raw, "sleepRoutineScore", "bedtimeConsistency", "score"));
  putNum("sleepStartConsistency", numAt(raw, "sleepRoutineScore", "sleepStartConsistency", "score"));
  putNum("wakeupConsistency", numAt(raw, "sleepRoutineScore", "wakeupConsistency", "score"));
  putNum("snoreMin", mins(numAt(raw, "snoreDuration")));
  putNum("heavySnoreMin", mins(numAt(raw, "heavySnoreDuration")));
  putNum("snorePct", numAt(raw, "snorePercent"));
  putNum("heavySnorePct", numAt(raw, "heavySnorePercent"));
  putNum("snoreReductionPct", numAt(raw, "snoringReductionPercent"));
  putNum("wasoMin", mins(numAt(raw, "wasoDuration")));
  putNum("wakeupCount", numAt(raw, "wakeupCount"));
  putNum("elevationMin", mins(numAt(raw, "elevationDuration")));
  putNum("awakeBeforeMin", mins(typeof summary?.awakeBeforeSleepDuration === "number" ? summary.awakeBeforeSleepDuration : undefined));
  putNum("awakeBetweenMin", mins(typeof summary?.awakeBetweenSleepDuration === "number" ? summary.awakeBetweenSleepDuration : undefined));
  putNum("awakeAfterMin", mins(typeof summary?.awakeAfterSleepDuration === "number" ? summary.awakeAfterSleepDuration : undefined));
  putNum("outMin", mins(typeof summary?.outDuration === "number" ? summary.outDuration : undefined));
  putNum("socialJetlagMin", mins(numAt(raw, "performanceWindows", "socialJetlag", "socialJetlagSeconds")));
  const bed = seriesMean(series?.tempBedC);
  const room = seriesMean(series?.tempRoomC);
  if (bed != null) metrics.tempBedC = bed;
  if (room != null) metrics.tempRoomC = room;
  const chrono = strAt(raw, "performanceWindows", "chronotype", "chronoClass");
  if (chrono) metrics.chronoClass = chrono;
  return metrics;
}

function seriesFromRaw(raw: unknown): TracePayload["series"] {
  const list = asObj(raw)?.sessions;
  if (!Array.isArray(list)) return [];
  const out: TracePayload["series"] = [];
  for (const item of list) {
    const session = asObj(item);
    const times = asObj(session?.timeseries);
    if (!times) continue;
    const kept = Object.fromEntries(Object.entries(times).filter(([, v]) => Array.isArray(v) && v.length > 0));
    if (Object.keys(kept).length === 0) continue;
    const id = typeof session?.id === "string" ? session.id : undefined;
    out.push({ ...(id ? { id } : {}), series: kept });
  }
  return out;
}

// Saves the whole Eight Sleep day. The night row keeps the summary the app reads; the trace row keeps everything else.
export function rowsFromRaw(raw: unknown, startOfDay: (ymd: string) => Date): EventRow[] {
  const parsed = SleepDay.safeParse(raw);
  if (!parsed.success || !hasSleep(parsed.data)) return [];
  const rows = rowsFromDay(parsed.data, startOfDay);
  const night = rows.find((row) => row.key === "sleep.night");
  if (!night || !isNight(night.payload)) return rows;
  const summary = night.payload;
  const extra = metricsFromRaw(raw);
  for (const key of Object.keys(extra) as (keyof NightPayload)[]) {
    const value = extra[key];
    if (value == null || summary[key] != null) continue;
    (summary as Record<string, unknown>)[key] = value;
  }
  const detail = omitKey(raw, "timeseries");
  const series = seriesFromRaw(raw);
  rows.push({
    ts: night.ts,
    domain: "sleep",
    key: "sleep.trace",
    valueNum: series.reduce((n, session) => n + Object.values(session.series).reduce((total: number, points: unknown) => total + (Array.isArray(points) ? points.length : 0), 0), 0),
    payload: { day: summary.day, detail: asObj(detail) ?? {}, series },
    source: EIGHT,
    sourceId: `trace:${summary.day}`,
  });
  return rows;
}

export function fmtMinutes(min: number | undefined): string {
  if (min == null) return "—";
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function mean(values: Array<number | undefined>): number | undefined {
  const xs = values.filter((v): v is number => v != null);
  if (xs.length === 0) return undefined;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
