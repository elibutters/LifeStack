import "server-only";
import { and, count, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { events, syncState } from "@lifestack/db";
import { db } from "./db";
import { addDays, startOfDay } from "./dates";

// Calendar events live in the shared `events` table:
//   domain = "calendar", key = "calendar.event", ts = start instant,
//   payload = { title, end?, allDay?, location? }  (end is an ISO timestamp with offset)
// All-day events start at midnight of their first day in APP_TZ and end at midnight
// after their last day. A sync worker only has to write rows in this shape.
const Payload = z.object({
  title: z.string().min(1),
  end: z.iso.datetime({ offset: true }).optional(),
  allDay: z.boolean().default(false),
  location: z.string().optional(),
});

export type CalendarItem = {
  id: number;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
};

export async function calendarItems(from: Date, to: Date): Promise<CalendarItem[]> {
  // Events can span days; look back far enough to catch ones that started earlier.
  const lookback = new Date(from.getTime() - 31 * 24 * 60 * 60 * 1000);
  const rows = await db()
    .select()
    .from(events)
    .where(and(eq(events.domain, "calendar"), eq(events.key, "calendar.event"), gte(events.ts, lookback), lt(events.ts, to)))
    .orderBy(events.ts);

  const items: CalendarItem[] = [];
  for (const row of rows) {
    const parsed = Payload.safeParse(row.payload);
    if (!parsed.success) continue;
    const { title, end, allDay, location } = parsed.data;
    const start = row.ts;
    const stop = end ? new Date(end) : start;
    const item: CalendarItem = { id: row.id, title, start, end: stop < start ? start : stop, allDay, location };
    if (overlaps(item, from, to)) items.push(item);
  }
  return items;
}

function overlaps(item: CalendarItem, from: Date, to: Date): boolean {
  if (item.start >= to) return false;
  if (item.end > from) return true;
  return item.end.getTime() === item.start.getTime() && item.start >= from;
}

export function itemsOnDay(items: CalendarItem[], day: string): CalendarItem[] {
  const from = startOfDay(day);
  const to = startOfDay(addDays(day, 1));
  return items.filter((i) => overlaps(i, from, to));
}

export async function systemStatus() {
  try {
    const [[e], sources] = await Promise.all([
      db().select({ n: count() }).from(events),
      db().select().from(syncState),
    ]);
    const gcal = sources.find((s) => s.source === "gcal");
    return {
      ok: true as const,
      events: e?.n ?? 0,
      sources: sources.length,
      calendarConnected: !!gcal?.lastOkAt,
      calendarSyncedAt: gcal?.lastOkAt ?? null,
    };
  } catch {
    return { ok: false as const };
  }
}
