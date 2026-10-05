// Compact today/week shapes for widgets, the iOS app and agents. Pure, so it can be tested alone.
import type { TodaySummary } from "./capture-core";

export type LogDigest = {
  mood: { value: number; at: string; count: number } | null;
  caffeine: { count: number; mg: number; lastAt: string | null };
  supplements: { name: string; count: number; lastAt: string }[];
};

export function logDigest(summary: TodaySummary): LogDigest {
  return {
    mood: summary.mood && { value: summary.mood.value, at: summary.mood.at.toISOString(), count: summary.mood.count },
    caffeine: { count: summary.caffeine.count, mg: summary.caffeine.mg, lastAt: summary.caffeine.lastAt?.toISOString() ?? null },
    supplements: summary.supplements.map((s) => ({ name: s.name, count: s.count, lastAt: s.lastAt.toISOString() })),
  };
}

export function calDigest(
  i: { title: string; start: Date; end: Date; allDay: boolean; kind: string; location?: string },
  ymd: (d: Date) => string,
) {
  return {
    title: i.title,
    start: i.allDay ? ymd(i.start) : i.start.toISOString(),
    end: i.allDay ? ymd(i.end) : i.end.toISOString(),
    allDay: i.allDay,
    kind: i.kind,
    location: i.location ?? null,
  };
}

export function sleepDigest(n: { day: string; score?: number; sleepMin?: number; deepMin?: number; remMin?: number } | undefined) {
  if (!n) return null;
  return {
    day: n.day,
    score: n.score ?? null,
    sleepMin: n.sleepMin ?? null,
    deepMin: n.deepMin ?? null,
    remMin: n.remMin ?? null,
  };
}

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function summarizeWeek(input: {
  from: string;
  to: string;
  days: { day: string; summary: TodaySummary }[];
  nights: { day: string; score?: number; sleepMin?: number }[];
  eventCount: number;
  spending: number | null;
}) {
  const moods = input.days.flatMap((d) => (d.summary.mood ? [d.summary.mood.value] : []));
  const scores = input.nights.flatMap((n) => (n.score != null ? [n.score] : []));
  const sleepMins = input.nights.flatMap((n) => (n.sleepMin != null ? [n.sleepMin] : []));
  return {
    from: input.from,
    to: input.to,
    mood: moods.length ? { avg: round1(mean(moods)), days: moods.length } : null,
    caffeineMg: input.days.reduce((s, d) => s + d.summary.caffeine.mg, 0),
    supplementDays: input.days.filter((d) => d.summary.supplements.length > 0).length,
    sleep: scores.length || sleepMins.length
      ? {
          nights: input.nights.length,
          avgScore: scores.length ? Math.round(mean(scores)) : null,
          avgSleepMin: sleepMins.length ? Math.round(mean(sleepMins)) : null,
        }
      : null,
    events: input.eventCount,
    spending: input.spending,
  };
}
