// The scheduling engine for goals: find real free time in the calendar, turn a goal into the sessions it needs, place those
// sessions into free time, and re-place one that slipped. Pure (no database, no network): everything comes in as arguments, so it
// is fully testable. Days are local calendar days as YYYY-MM-DD in the owner's time zone; times are real instants.
export type Interval = { start: Date; end: Date };
export type Hours = [startMin: number, endMin: number];

export type Constraints = {
  tz: string;
  weekdayHours: Hours[]; // when sessions may happen Monday to Friday, as local minutes after midnight
  weekendHours: Hours[]; // Saturday and Sunday
  latestEndMin: number; // nothing ends after this local minute
  maxPerDay: number; // sessions per day, across every goal
  bufferMin: number; // breathing room kept around meetings and other sessions
  preferredStartMin: number; // where in a free stretch a session likes to start
};

export const DEFAULT_CONSTRAINTS: Constraints = {
  tz: "UTC",
  weekdayHours: [[18 * 60, 22 * 60 + 30]],
  weekendHours: [[9 * 60, 21 * 60]],
  latestEndMin: 22 * 60 + 30,
  maxPerDay: 2,
  bufferMin: 15,
  preferredStartMin: 19 * 60,
};

// ---- local time
const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(tz, f);
  }
  return f;
}

function partsOf(d: Date, tz: string) {
  const p: Record<string, number> = {};
  for (const x of fmt(tz).formatToParts(d)) if (x.type !== "literal") p[x.type] = Number(x.value);
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

const offsetMin = (d: Date, tz: string) => {
  const p = partsOf(d, tz);
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000) / 60000;
};

export const addDay = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
// Monday is 0, as everywhere else in the app.
export const weekdayOf = (day: string) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
};
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function localDay(d: Date, tz: string): string {
  const p = partsOf(d, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

// The instant at a local time on a local day, correct across daylight saving changes.
export function localToDate(day: string, minutes: number, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const asUtc = Date.UTC(y, m - 1, d, 0, minutes);
  const first = asUtc - offsetMin(new Date(asUtc), tz) * 60000;
  return new Date(asUtc - offsetMin(new Date(first), tz) * 60000);
}

const mins = (i: Interval) => (i.end.getTime() - i.start.getTime()) / 60000;

// What is left of an interval after taking out blocked stretches.
function subtract(base: Interval, blocked: Interval[]): Interval[] {
  let pieces = [base];
  for (const b of blocked) {
    const next: Interval[] = [];
    for (const p of pieces) {
      if (b.end <= p.start || b.start >= p.end) next.push(p);
      else {
        if (b.start > p.start) next.push({ start: p.start, end: b.start });
        if (b.end < p.end) next.push({ start: b.end, end: p.end });
      }
    }
    pieces = next;
  }
  return pieces;
}

const pad = (list: Interval[], min: number): Interval[] => list.map((i) => ({ start: new Date(i.start.getTime() - min * 60000), end: new Date(i.end.getTime() + min * 60000) }));

// ---- free time
// The stretches inside the allowed hours that no busy interval touches, from `from` to `to`, never earlier than `now`.
export function freeSlots(from: Date, to: Date, busy: Interval[], c: Constraints, now: Date = new Date(), minMin = 15): Interval[] {
  const out: Interval[] = [];
  const blocked = pad(busy, c.bufferMin);
  const last = localDay(to, c.tz);
  for (let day = localDay(from, c.tz); day <= last; day = addDay(day, 1)) {
    for (const [s, e] of weekdayOf(day) >= 5 ? c.weekendHours : c.weekdayHours) {
      let start = localToDate(day, s, c.tz);
      let end = localToDate(day, Math.min(e, c.latestEndMin), c.tz);
      if (start < from) start = from;
      if (start < now) start = now;
      if (end > to) end = to;
      if (end <= start) continue;
      out.push(...subtract({ start, end }, blocked).filter((i) => mins(i) >= minMin));
    }
  }
  return out;
}

// ---- sessions
// One session a goal wants: on `day` (give or take `flexDays`), `durationMin` long.
export type Desired = { key?: string; title: string; day: string; durationMin: number; flexDays?: number; earliestDay?: string; latestDay?: string; note?: string; startMin?: number }; // startMin: where in free time this one likes to start (local minutes), instead of the general preference
export type Placed = Desired & { start: Date; end: Date; placedDay: string; shiftedDays: number };
export type Unplaced = { desired: Desired; reason: string };

// A start inside free time for `durationMin` on a local day, nearest the preferred start, or null.
function fit(day: string, durationMin: number, free: Interval[], taken: Interval[], c: Constraints, startMin = c.preferredStartMin): Interval | null {
  const dayStart = localToDate(day, 0, c.tz);
  const dayEnd = localToDate(addDay(day, 1), 0, c.tz);
  const preferred = localToDate(day, startMin, c.tz).getTime();
  const blocked = pad(taken, c.bufferMin);
  let best: Interval | null = null;
  let bestDist = Infinity;
  for (const f of free) {
    const base = { start: f.start > dayStart ? f.start : dayStart, end: f.end < dayEnd ? f.end : dayEnd };
    if (base.end <= base.start) continue;
    for (const piece of subtract(base, blocked)) {
      if (mins(piece) < durationMin) continue;
      const latestStart = piece.end.getTime() - durationMin * 60000;
      const start = Math.min(Math.max(preferred, piece.start.getTime()), latestStart);
      const dist = Math.abs(start - preferred);
      if (dist < bestDist) {
        bestDist = dist;
        best = { start: new Date(start), end: new Date(start + durationMin * 60000) };
      }
    }
  }
  return best;
}

// Puts each wanted session into free time. A session goes on its day if it can, otherwise the nearest day within its flex, and it
// is reported (not dropped silently) when nothing fits. `existing` are sessions already on the calendar: they block time and count
// toward the per-day limit.
export function place(desired: Desired[], free: Interval[], c: Constraints, existing: Interval[] = []): { placed: Placed[]; unplaced: Unplaced[] } {
  const taken: Interval[] = [...existing];
  const perDay = new Map<string, number>();
  for (const e of existing) perDay.set(localDay(e.start, c.tz), (perDay.get(localDay(e.start, c.tz)) ?? 0) + 1);
  const placed: Placed[] = [];
  const unplaced: Unplaced[] = [];
  const order = [...desired].sort((a, b) => a.day.localeCompare(b.day) || (a.flexDays ?? 1) - (b.flexDays ?? 1));
  for (const d of order) {
    const flex = d.flexDays ?? 1;
    const offsets = [0];
    for (let k = 1; k <= flex; k++) offsets.push(k, -k);
    let done = false;
    for (const off of offsets) {
      const day = addDay(d.day, off);
      if ((d.earliestDay && day < d.earliestDay) || (d.latestDay && day > d.latestDay)) continue;
      if ((perDay.get(day) ?? 0) >= c.maxPerDay) continue;
      const slot = fit(day, d.durationMin, free, taken, c, d.startMin);
      if (!slot) continue;
      taken.push(slot);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
      placed.push({ ...d, start: slot.start, end: slot.end, placedDay: day, shiftedDays: off });
      done = true;
      break;
    }
    if (!done) unplaced.push({ desired: d, reason: `no ${d.durationMin} minute gap within ${flex} day${flex === 1 ? "" : "s"} of ${d.day}` });
  }
  return { placed: placed.sort((a, b) => a.start.getTime() - b.start.getTime()), unplaced };
}

// ---- turning a goal into wanted sessions
const round5 = (n: number) => Math.max(15, Math.round(n / 5) * 5);

// Prep for a date: a session every `everyDays` counting back from the day before the target, lighter near the end.
export function cadence(o: { fromDay: string; targetDay: string; everyDays: number; durationMin: number; title: string; stopBeforeDays?: number; taperLast?: number; taperFactor?: number; flexDays?: number; startMin?: number }): Desired[] {
  const days: string[] = [];
  for (let d = addDay(o.targetDay, -(o.stopBeforeDays ?? 1)); d >= o.fromDay; d = addDay(d, -Math.max(1, o.everyDays))) days.unshift(d);
  const taper = o.taperLast ?? 0;
  return days.map((day, i) => {
    const light = taper > 0 && i >= days.length - taper;
    return { title: light ? `${o.title} (light)` : o.title, day, durationMin: light ? round5(o.durationMin * (o.taperFactor ?? 0.5)) : o.durationMin, flexDays: o.flexDays ?? 1, startMin: o.startMin };
  });
}

// Steady progress toward a deadline: a session each day (or each chosen weekday, Monday 0).
export function daily(o: { fromDay: string; toDay: string; durationMin: number; title: string; weekdays?: number[]; flexDays?: number; startMin?: number }): Desired[] {
  const out: Desired[] = [];
  for (let d = o.fromDay; d <= o.toDay; d = addDay(d, 1)) if (!o.weekdays || o.weekdays.includes(weekdayOf(d))) out.push({ title: o.title, day: d, durationMin: o.durationMin, flexDays: o.flexDays ?? 1, startMin: o.startMin });
  return out;
}

export type TemplateSlot = { weekday: number; durationMin: number; title: string; startMin?: number };

// A repeating week, scaled week by week (a training block ramps up, deloads and tapers).
export function weeklyPlan(o: { fromDay: string; toDay: string; template: TemplateSlot[]; multipliers?: number[]; flexDays?: number }): Desired[] {
  const monday = addDay(o.fromDay, -weekdayOf(o.fromDay));
  const out: Desired[] = [];
  for (let w = 0; addDay(monday, w * 7) <= o.toDay; w++) {
    const scale = o.multipliers?.[w] ?? 1;
    for (const t of o.template) {
      const day = addDay(monday, w * 7 + t.weekday);
      if (day < o.fromDay || day > o.toDay) continue;
      out.push({ title: t.title, day, durationMin: round5(t.durationMin * scale), flexDays: o.flexDays ?? 1, startMin: t.startMin });
    }
  }
  return out;
}

// Volume for each week of a block: builds toward the peak, steps back every fourth week, then tapers over the last two.
export function trainingMultipliers(weeks: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < weeks; i++) {
    if (weeks >= 4 && i >= weeks - 2) {
      out.push(i === weeks - 2 ? 0.7 : 0.5);
      continue;
    }
    const progress = weeks > 1 ? i / (weeks - 1) : 1;
    let v = 0.8 + 0.35 * Math.min(1, progress / 0.75);
    if (i % 4 === 3) v *= 0.8;
    out.push(Math.round(v * 100) / 100);
  }
  return out;
}

// ---- is the plan realistic, and moving a session that slipped
export function feasibility(desired: Desired[], free: Interval[]) {
  const neededMin = desired.reduce((s, d) => s + d.durationMin, 0);
  const availableMin = free.reduce((s, f) => s + mins(f), 0);
  return { neededMin, availableMin, shortMin: Math.max(0, neededMin - availableMin) };
}

export type SessionStatus = "planned" | "done" | "skipped" | "missed";

// A planned session whose end passed more than `graceMin` ago without a Done is missed.
export const statusAt = (s: { status: SessionStatus; end: Date }, now: Date, graceMin = 60): SessionStatus => (s.status === "planned" && now.getTime() > s.end.getTime() + graceMin * 60000 ? "missed" : s.status);

// A new slot for one session: the next day with room at least `leadMin` after `now`, no later than the goal's last day. Null when there is none, which
// is when the plan should stop moving things and ask.
export function reschedule(o: { durationMin: number; free: Interval[]; c: Constraints; existing: Interval[]; now: Date; lastDay?: string; searchDays?: number; leadMin?: number }): Interval | null {
  const today = localDay(o.now, o.c.tz);
  const perDay = new Map<string, number>();
  for (const e of o.existing) perDay.set(localDay(e.start, o.c.tz), (perDay.get(localDay(e.start, o.c.tz)) ?? 0) + 1);
  for (let i = 0; i <= (o.searchDays ?? 14); i++) {
    const day = addDay(today, i);
    if (o.lastDay && day > o.lastDay) return null;
    if ((perDay.get(day) ?? 0) >= o.c.maxPerDay) continue;
    const slot = fit(day, o.durationMin, o.free, o.existing, o.c);
    if (slot && slot.start.getTime() >= o.now.getTime() + (o.leadMin ?? 30) * 60000) return slot; // never "right now"
  }
  return null;
}
