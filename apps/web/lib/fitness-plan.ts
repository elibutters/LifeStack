import "server-only";
import { and, asc, eq, gte, notInArray, sql } from "drizzle-orm";
import { events, planSlots, syncState } from "@lifestack/db";
import { db } from "./db";
import { addDays, atTime, startOfDay, todayInTz } from "./dates";
import { describeError } from "./errors";
import {
  horizonEnd,
  occurrences,
  parseSlot,
  PLAN_SOURCE,
  type PlanKind,
  type PlanSlot,
  type Occurrence,
} from "./fitness-plan-core";

const toSlot = (r: typeof planSlots.$inferSelect): PlanSlot => ({
  id: r.id,
  weekday: r.weekday,
  kind: r.kind === "prep" ? "prep" : "workout",
  title: r.title,
  notes: r.notes,
  startMin: r.startMin,
  durationMin: r.durationMin,
});

export async function listSlots(): Promise<PlanSlot[]> {
  return (await db().select().from(planSlots).orderBy(asc(planSlots.weekday), sql`${planSlots.startMin} asc nulls last`, asc(planSlots.id))).map(toSlot);
}

function eventRow(o: Occurrence) {
  const start = o.allDay ? startOfDay(o.date) : atTime(o.date, Math.floor(o.startMin! / 60), o.startMin! % 60);
  const end = o.allDay ? startOfDay(addDays(o.date, 1)) : new Date(start.getTime() + o.durationMin! * 60_000);
  return {
    ts: start,
    domain: "calendar" as const,
    key: "calendar.event",
    source: PLAN_SOURCE,
    sourceId: o.sourceId,
    payload: {
      title: o.title,
      end: end.toISOString(),
      allDay: o.allDay,
      kind: o.kind satisfies PlanKind,
      ...(o.notes ? { detail: o.notes } : {}),
    },
  };
}

// Rewrites plan events from `today` through the horizon. Earlier plan events stay, so a past day
// keeps what was on the calendar then. An empty plan clears today and later.
export async function syncPlan(today: string) {
  const slots = await listSlots();
  const end = horizonEnd(today);
  const rows = occurrences(slots, today, end).map(eventRow);
  const keep = rows.map((r) => r.sourceId);
  await db().transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += 500) {
      await tx
        .insert(events)
        .values(rows.slice(i, i + 500))
        .onConflictDoUpdate({
          target: [events.source, events.sourceId],
          set: { ts: sql`excluded.ts`, payload: sql`excluded.payload` },
        });
    }
    await tx.delete(events).where(and(eq(events.source, PLAN_SOURCE), gte(events.ts, startOfDay(today)), keep.length ? notInArray(events.sourceId, keep) : undefined));
    await tx
      .insert(syncState)
      .values({ source: PLAN_SOURCE, cursor: end, lastOkAt: new Date(), lastError: null })
      .onConflictDoUpdate({ target: syncState.source, set: { cursor: end, lastOkAt: new Date(), lastError: null } });
  });
}

// Extends the calendar window as days pass, without rewriting it on every open.
export async function syncPlanHorizon() {
  try {
    const today = todayInTz();
    const end = horizonEnd(today);
    const [state] = await db().select().from(syncState).where(eq(syncState.source, PLAN_SOURCE));
    if (state?.cursor && state.cursor >= end && state.lastOkAt && !state.lastError) return;
    await syncPlan(today);
  } catch (e) {
    console.error("plan: calendar sync failed", describeError(e));
  }
}

export async function addSlot(raw: { weekday: string; kind: string; title: string; notes: string; time: string; duration: string }) {
  const parsed = parseSlot(raw);
  if (!parsed.ok) return { ok: false as const };
  await db().insert(planSlots).values(parsed.value);
  await syncPlan(todayInTz());
  return { ok: true as const };
}

export async function deleteSlot(id: number) {
  await db().delete(planSlots).where(eq(planSlots.id, id));
  await syncPlan(todayInTz());
}
