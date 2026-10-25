import { z } from "zod";
import { addDays } from "./dates";

// The repeating Fitness plan. Pure: no database. weekday 0 is Monday, matching weekStart in workouts-core.
export const PLAN_SOURCE = "plan";
export const PLAN_HORIZON_DAYS = 56;
export const PLAN_KINDS = ["workout", "prep"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const WEEKDAYS = [
  { id: 0, label: "Monday", short: "Mon" },
  { id: 1, label: "Tuesday", short: "Tue" },
  { id: 2, label: "Wednesday", short: "Wed" },
  { id: 3, label: "Thursday", short: "Thu" },
  { id: 4, label: "Friday", short: "Fri" },
  { id: 5, label: "Saturday", short: "Sat" },
  { id: 6, label: "Sunday", short: "Sun" },
] as const;

export type SlotInput = {
  weekday: number;
  kind: PlanKind;
  title: string;
  notes: string | null;
  startMin: number | null;
  durationMin: number | null;
};

export type PlanSlot = SlotInput & { id: number };

export type Occurrence = {
  sourceId: string;
  date: string;
  title: string;
  kind: PlanKind;
  notes: string | null;
  allDay: boolean;
  startMin: number | null;
  durationMin: number | null;
};

const Fields = z.object({
  weekday: z.coerce.number().int().min(0).max(6),
  kind: z.enum(PLAN_KINDS),
  title: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(280),
  time: z.string().trim().max(8),
  duration: z.string().trim().max(4),
});

// Minutes from local midnight, or null for all day. undefined means the value is not a clock time.
function startOf(raw: string): number | null | undefined {
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
  if (!m) return undefined;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return undefined;
  return hour * 60 + minute;
}

function durationOf(raw: string): number | null | undefined {
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  if (n < 1 || n > 720) return undefined;
  return n;
}

export function parseSlot(raw: {
  weekday: string;
  kind: string;
  title: string;
  notes: string;
  time: string;
  duration: string;
}): { ok: true; value: SlotInput } | { ok: false } {
  const fields = Fields.safeParse(raw);
  if (!fields.success) return { ok: false };
  const startMin = startOf(fields.data.time);
  const durationMin = durationOf(fields.data.duration);
  if (startMin === undefined || durationMin === undefined) return { ok: false };
  return {
    ok: true,
    value: {
      weekday: fields.data.weekday,
      kind: fields.data.kind,
      title: fields.data.title,
      notes: fields.data.notes || null,
      startMin,
      // A length only means something once the item has a start time.
      durationMin: startMin == null ? null : durationMin,
    },
  };
}

export const weekdayOf = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
export const horizonEnd = (today: string) => addDays(today, PLAN_HORIZON_DAYS - 1);
export const sourceIdFor = (id: number, date: string) => `${PLAN_SOURCE}:${id}:${date}`;

// Every date from `from` through `to` (inclusive) that matches a slot's weekday.
export function occurrences(slots: PlanSlot[], from: string, to: string): Occurrence[] {
  if (from > to) return [];
  const out: Occurrence[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const weekday = weekdayOf(date);
    for (const slot of slots) {
      if (slot.weekday !== weekday) continue;
      const allDay = slot.startMin == null;
      out.push({
        sourceId: sourceIdFor(slot.id, date),
        date,
        title: slot.title,
        kind: slot.kind,
        notes: slot.notes,
        allDay,
        startMin: slot.startMin,
        durationMin: allDay ? null : (slot.durationMin ?? 60),
      });
    }
  }
  return out;
}

export function fmtClock(min: number): string {
  const hour = Math.floor(min / 60);
  const minute = min % 60;
  const suffix = hour < 12 ? "AM" : "PM";
  const hr = hour % 12 || 12;
  return `${hr}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function fmtLength(min: number): string {
  const hour = Math.floor(min / 60);
  const minute = min % 60;
  if (!hour) return `${minute} min`;
  return minute ? `${hour}h ${minute}m` : `${hour}h`;
}
