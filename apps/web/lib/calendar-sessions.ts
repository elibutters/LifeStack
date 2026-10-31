import "server-only";
import type { CalendarItem } from "./calendar";
import { listGoals, sessionJson, sessionsOf } from "./goals";

// A goal session that has an Outlook event is the same thing as that calendar item. Matching on the event id lets the calendar show what
// the goal knows about it: whether it is done or skipped, its note, the run it was linked to and where.
export type SessionDetail = ReturnType<typeof sessionJson> & { goal: string | null };

export async function sessionsForItems(items: CalendarItem[]): Promise<Map<number, SessionDetail>> {
  const ids = new Set(items.flatMap((i) => (i.sourceId ? [i.sourceId] : [])));
  const out = new Map<number, SessionDetail>();
  if (ids.size === 0) return out;
  const [sessions, goals] = await Promise.all([sessionsOf(), listGoals()]);
  const byEvent = new Map(sessions.flatMap((s) => (s.outlookEventId ? [[s.outlookEventId, s] as const] : [])));
  const names = new Map(goals.map((g) => [g.id, g.title]));
  for (const i of items) {
    const s = i.sourceId ? byEvent.get(i.sourceId) : undefined;
    if (s) out.set(i.id, { ...sessionJson(s), goal: names.get(s.goalId) ?? null });
  }
  return out;
}
