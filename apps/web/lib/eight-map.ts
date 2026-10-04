import { z } from "zod";

export const EIGHT = "eight";

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
  sessions?: { id?: string; start?: string; end?: string; stages?: { stage: string; durationMin: number }[] }[];
};

export type EventRow = {
  ts: Date;
  domain: "sleep";
  key: string;
  valueNum?: number;
  payload: NightPayload | Record<string, never>;
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
