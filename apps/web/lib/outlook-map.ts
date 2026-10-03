import { z } from "zod";

// Maps one Microsoft Graph event to the shape stored in `events` (see lib/calendar.ts).
// Kept free of server-only imports so it can be tested on its own.
const GraphEvent = z.object({
  id: z.string().min(1),
  subject: z.string().nullish(),
  isAllDay: z.boolean().nullish(),
  isCancelled: z.boolean().nullish(),
  start: z.object({ dateTime: z.string() }),
  end: z.object({ dateTime: z.string() }),
  location: z.object({ displayName: z.string().nullish() }).nullish(),
});

export type EventKind = "event" | "holiday";

export type EventRow = {
  ts: Date;
  domain: "calendar";
  key: "calendar.event";
  payload: { title: string; end: string; allDay: boolean; kind: EventKind; location?: string };
  source: "outlook";
  sourceId: string;
};

// Graph returns UTC times as "2026-10-05T13:00:00.0000000" (no zone suffix).
const utc = (s: string) => new Date(`${s.replace(/\.\d+$/, "")}Z`);

export type Mapped = { kind: "row"; row: EventRow } | { kind: "cancelled" } | { kind: "invalid"; id?: string };

export function toRow(raw: unknown, startOfDay: (day: string) => Date, kind: EventKind = "event"): Mapped {
  const parsed = GraphEvent.safeParse(raw);
  const rawId = (raw as { id?: unknown } | null)?.id;
  const invalid: Mapped = { kind: "invalid", id: typeof rawId === "string" ? rawId : undefined };
  if (!parsed.success) return invalid;
  if (parsed.data.isCancelled) return { kind: "cancelled" };
  const e = parsed.data;
  const allDay = !!e.isAllDay;
  // All-day events are dates, not instants: anchor them to midnight in the owner's timezone.
  const start = allDay ? startOfDay(e.start.dateTime.slice(0, 10)) : utc(e.start.dateTime);
  const end = allDay ? startOfDay(e.end.dateTime.slice(0, 10)) : utc(e.end.dateTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return invalid;
  const location = e.location?.displayName?.trim();
  return {
    kind: "row",
    row: {
      ts: start,
      domain: "calendar",
      key: "calendar.event",
      payload: { title: e.subject?.trim() || "(No title)", end: end.toISOString(), allDay, kind, ...(location ? { location } : {}) },
      source: "outlook",
      sourceId: e.id,
    },
  };
}
