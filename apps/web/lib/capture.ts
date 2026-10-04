import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { events, supplements } from "@lifestack/db";
import { CAPTURE_KEYS, resolveTime, summarizeToday, toRow, type Entry, type EventInputT } from "./capture-core";
import { db } from "./db";
import { addDays, startOfDay, todayInTz } from "./dates";

const isCapture = inArray(events.key, [...CAPTURE_KEYS]);
const unitOf = (payload: unknown) => (payload && typeof payload === "object" && typeof (payload as { unit?: unknown }).unit === "string" ? (payload as { unit: string }).unit : null);
const toEntry = (r: typeof events.$inferSelect): Entry => ({ id: r.id, ts: r.ts, key: r.key, valueNum: r.valueNum, valueText: r.valueText, source: r.source, unit: unitOf(r.payload) });

// Writes one entry. Sending the same `sourceId` again returns the existing entry instead of a duplicate.
export async function insertLog(
  input: EventInputT,
  source: string,
  opts: { sourceId?: string; now?: Date } = {},
): Promise<{ ok: true; id: number; ts: Date; created: boolean } | { ok: false; error: string }> {
  const now = opts.now ?? new Date();
  const when = resolveTime(input.at, now);
  if (!when.ok) return when;
  const sourceId = input.id ?? opts.sourceId ?? randomUUID();
  // A supplement is taken or not on a given day: logging it again updates that day's entry (for example a new dose)
  // instead of adding another, so the same supplement can never show up twice in a day.
  if (input.type === "supplement") {
    const day = todayInTz(when.ts);
    const [hit] = await db()
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.key, "supplement.taken"), sql`lower(${events.valueText}) = ${input.name.trim().toLowerCase()}`, gte(events.ts, startOfDay(day)), lt(events.ts, startOfDay(addDays(day, 1)))))
      .limit(1);
    if (hit) {
      const row = toRow(input, when.ts, source, sourceId);
      await db().update(events).set({ valueNum: row.valueNum, payload: row.payload, ts: row.ts }).where(eq(events.id, hit.id));
      return { ok: true, id: hit.id, ts: when.ts, created: false };
    }
  }
  const row = toRow(input, when.ts, source, sourceId);
  const [made] = await db().insert(events).values(row).onConflictDoNothing({ target: [events.source, events.sourceId] }).returning({ id: events.id, ts: events.ts });
  if (made) return { ok: true, id: made.id, ts: made.ts, created: true };
  const [existing] = await db().select({ id: events.id, ts: events.ts }).from(events).where(and(eq(events.source, source), eq(events.sourceId, sourceId)));
  return existing ? { ok: true, id: existing.id, ts: existing.ts, created: false } : { ok: false, error: "could not save" };
}

export async function loadToday(now = new Date()) {
  const today = todayInTz(now);
  const rows = await db()
    .select()
    .from(events)
    .where(and(isCapture, gte(events.ts, startOfDay(today)), lt(events.ts, startOfDay(addDays(today, 1)))));
  return { date: today, summary: summarizeToday(rows.map(toEntry)) };
}

export async function loadFeed(limit = 100): Promise<Entry[]> {
  const rows = await db().select().from(events).where(isCapture).orderBy(desc(events.ts), desc(events.id)).limit(limit);
  return rows.map(toEntry);
}

// Only ever removes capture entries, never anything else in the events table.
export async function deleteLog(id: number): Promise<boolean> {
  const gone = await db().delete(events).where(and(eq(events.id, id), isCapture)).returning({ id: events.id });
  return gone.length > 0;
}

export async function listSupplements() {
  return db().select().from(supplements).where(eq(supplements.active, true)).orderBy(supplements.createdAt);
}

export async function addSupplement(name: string): Promise<boolean> {
  const clean = name.trim().slice(0, 60);
  if (!clean) return false;
  const existing = await db().select({ id: supplements.id }).from(supplements).where(and(eq(supplements.active, true), sql`lower(${supplements.name}) = ${clean.toLowerCase()}`));
  if (existing.length) return false;
  await db().insert(supplements).values({ name: clean });
  return true;
}

export async function archiveSupplement(id: number) {
  await db().update(supplements).set({ active: false }).where(eq(supplements.id, id));
}
