import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { events } from "@lifestack/db";
import { db } from "./db";
import type { CalendarItem } from "./calendar";
import { busyBetween, loadConstraints, refreshCalendar, sessionsOf } from "./goals";
import { clashes, ONEOFF_DEFAULT_MIN, resolveWindow, type Blocker, type Window } from "./oneoff-core";
import { createEvents, deleteEvent as deleteOutlookEvent, NEEDS_WRITE, updateEvent } from "./outlook-write";

// One-off calendar events: a call, an appointment, an errand. They belong to no goal, so an agent can add one without inventing a goal to hold
// it. Each is written to the owner's Outlook calendar the same careful way sessions are (the "Life Stack" category, created idempotently) and
// remembered here, because Life Stack only ever moves or deletes events it created itself. Stored as an events row (source "oneoff"), which
// the calendar and the free-time rules never read: they see the Outlook copy after the next sync, like any other event.
const SRC = "oneoff";
type Row = typeof events.$inferSelect;

const rowOf = async (id: string): Promise<Row | null> => {
  const [r] = await db().select().from(events).where(and(eq(events.source, SRC), eq(events.sourceId, `oneoff:${id}`)));
  return r ?? null;
};
const pay = (r: Row) => (r.payload ?? {}) as Record<string, unknown>;

export function oneOffJson(r: Row) {
  const p = pay(r);
  return { id: r.sourceId!.slice("oneoff:".length), title: String(p.title ?? ""), start: r.ts.toISOString(), end: String(p.end ?? r.ts.toISOString()), location: typeof p.location === "string" ? p.location : null, note: typeof p.note === "string" ? p.note : null, onCalendar: typeof p.outlookEventId === "string" };
}

const WHY: Record<string, string> = { not_connected: "Outlook is not connected, so nothing was added.", needs_reconnect: NEEDS_WRITE, failed: "Outlook did not accept that, so nothing was changed. Try again shortly." };

// What a window runs into: meetings and events on the calendar, planned sessions, and other one-off events added here. Life Stack's own session
// events and one-off events are counted from their own records, never from their Outlook copies (which only appear after the next sync, and
// would count twice after it). `exceptId` leaves out the one-off being moved, so it never clashes with its own old slot.
async function blockersFor(w: Window, exceptId?: string): Promise<Blocker[]> {
  const [sessions, oneOffs] = await Promise.all([sessionsOf(), db().select().from(events).where(eq(events.source, SRC))]);
  const own = new Set(sessions.map((s) => s.outlookEventId).filter((x): x is string => !!x));
  for (const r of oneOffs) if (typeof pay(r).outlookEventId === "string") own.add(pay(r).outlookEventId as string);
  const busy = await busyBetween(w.start, w.end, own);
  const planned = sessions.filter((s) => s.status === "planned" && s.end > w.start && s.start < w.end);
  const others = oneOffs.map(oneOffJson).filter((o) => o.id !== exceptId).map((o) => ({ start: new Date(o.start), end: new Date(o.end), what: `another event you added ("${o.title}")` }));
  return [
    ...busy.map((b) => ({ ...b, what: "something already on your calendar" })),
    ...planned.map((s) => ({ start: s.start, end: s.end, what: `a planned session ("${s.title}")` })),
    ...others,
  ];
}

const Add = z.object({
  title: z.string().trim().min(1).max(200),
  start: z.string().min(1),
  end: z.string().optional(),
  minutes: z.number().int().optional(),
  location: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2000).optional(),
  allowOverlap: z.boolean().optional(),
});

export async function addEvent(input: unknown, now = new Date()) {
  const p = Add.safeParse(input);
  if (!p.success) return { ok: false as const, error: p.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ") };
  const c = await loadConstraints();
  const w = resolveWindow(p.data, c.tz, now);
  if (!w.ok) return { ok: false as const, error: w.error };
  if (!p.data.allowOverlap) {
    const hits = clashes(w.window, await blockersFor(w.window));
    if (hits.length) return { ok: false as const, error: `That overlaps ${hits.length === 1 ? "something" : `${hits.length} things`} already on your calendar. Nothing was added. Pick another time, or pass allowOverlap to add it anyway.`, conflicts: hits };
  }
  const id = `e${randomBytes(4).toString("hex")}`;
  const cal = await createEvents([{ key: `oneoff-${id}`, title: p.data.title, start: w.window.start, end: w.window.end, body: p.data.note, location: p.data.location }]);
  if (!cal.ok) return { ok: false as const, error: WHY[cal.reason] ?? WHY.failed! };
  const outlookEventId = cal.value[0]!.id;
  await db().insert(events).values({
    ts: w.window.start, domain: "calendar", key: "calendar.oneoff", valueNum: (w.window.end.getTime() - w.window.start.getTime()) / 60_000, valueText: p.data.title,
    payload: { title: p.data.title, end: w.window.end.toISOString(), outlookEventId, ...(p.data.location ? { location: p.data.location } : {}), ...(p.data.note ? { note: p.data.note } : {}) },
    source: SRC, sourceId: `oneoff:${id}`,
  });
  refreshCalendar();
  return { ok: true as const, calendar: "ok" as const, event: oneOffJson((await rowOf(id))!), timeZone: c.tz };
}

const Move = z.object({ start: z.string().min(1), end: z.string().optional(), minutes: z.number().int().optional(), allowOverlap: z.boolean().optional() });

// Moves an event added with add_event. Keeps its length unless an end or minutes is given.
export async function moveEvent(id: string, input: unknown, now = new Date()) {
  const r = await rowOf(id);
  if (!r) return { ok: false as const, error: "No such one-off event. Only events added with add_event can be moved here." };
  const p = Move.safeParse(input);
  if (!p.success) return { ok: false as const, error: p.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ") };
  const was = oneOffJson(r);
  const keep = Math.max(1, Math.round((new Date(was.end).getTime() - new Date(was.start).getTime()) / 60_000)) || ONEOFF_DEFAULT_MIN;
  const c = await loadConstraints();
  const w = resolveWindow({ start: p.data.start, end: p.data.end, minutes: p.data.end === undefined ? p.data.minutes ?? keep : undefined }, c.tz, now);
  if (!w.ok) return { ok: false as const, error: w.error };
  const outlookEventId = typeof pay(r).outlookEventId === "string" ? (pay(r).outlookEventId as string) : undefined;
  if (!p.data.allowOverlap) {
    const hits = clashes(w.window, await blockersFor(w.window, id));
    if (hits.length) return { ok: false as const, error: `That overlaps ${hits.length === 1 ? "something" : `${hits.length} things`} already on your calendar. Nothing was moved. Pick another time, or pass allowOverlap to move it anyway.`, conflicts: hits };
  }
  if (outlookEventId) {
    const cal = await updateEvent(outlookEventId, { start: w.window.start, end: w.window.end });
    if (!cal.ok) return { ok: false as const, error: WHY[cal.reason] ?? WHY.failed! };
  }
  await db().update(events).set({ ts: w.window.start, valueNum: (w.window.end.getTime() - w.window.start.getTime()) / 60_000, payload: { ...pay(r), end: w.window.end.toISOString() } })
    .where(and(eq(events.source, SRC), eq(events.sourceId, `oneoff:${id}`)));
  refreshCalendar();
  return { ok: true as const, calendar: "ok" as const, event: oneOffJson((await rowOf(id))!), was: { start: was.start, end: was.end }, timeZone: c.tz };
}

// Removes an event added with add_event, from Outlook and from here. An event already gone from Outlook counts as removed.
export async function removeEvent(id: string) {
  const r = await rowOf(id);
  if (!r) return { ok: false as const, error: "No such one-off event. Only events added with add_event can be removed here." };
  const outlookEventId = typeof pay(r).outlookEventId === "string" ? (pay(r).outlookEventId as string) : undefined;
  if (outlookEventId) {
    const cal = await deleteOutlookEvent(outlookEventId);
    if (!cal.ok) return { ok: false as const, error: WHY[cal.reason] ?? WHY.failed! };
  }
  const was = oneOffJson(r);
  await db().delete(events).where(and(eq(events.source, SRC), eq(events.sourceId, `oneoff:${id}`)));
  refreshCalendar();
  return { ok: true as const, calendar: "ok" as const, removed: { id: was.id, title: was.title, start: was.start, end: was.end } };
}

// Which calendar rows are one-off events Life Stack added, by the Outlook id they were saved with, so an agent reading the calendar can move or
// delete them by id.
export async function oneOffsForItems(items: CalendarItem[]): Promise<Map<number, { id: string }>> {
  const out = new Map<number, { id: string }>();
  const ids = new Set(items.flatMap((i) => (i.sourceId ? [i.sourceId] : [])));
  if (ids.size === 0) return out;
  const rows = await db().select().from(events).where(eq(events.source, SRC));
  const byEvent = new Map(rows.flatMap((r) => (typeof pay(r).outlookEventId === "string" ? [[pay(r).outlookEventId as string, r.sourceId!.slice("oneoff:".length)] as const] : [])));
  for (const i of items) {
    const id = i.sourceId ? byEvent.get(i.sourceId) : undefined;
    if (id) out.set(i.id, { id });
  }
  return out;
}
