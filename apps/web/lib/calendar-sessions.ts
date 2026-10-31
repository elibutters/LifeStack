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

// Skipping a session takes its event off Outlook so the calendar is not cluttered, so a skipped session would otherwise vanish from the
// calendar altogether. These put it back as an item of its own, shown struck through and marked Skipped. A skipped session whose event could
// not be removed is still an Outlook item (and already marked by the join above), and one that was replaced by a session at the same time is
// not shown: the replacement stands for it.
const syntheticId = (sessionId: string) => {
  let h = 0;
  for (const ch of sessionId) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return -(Math.abs(h) % 2_000_000_000) - 1; // negative, so it never collides with a stored event id
};

export async function skippedItems(from: Date, to: Date): Promise<{ items: CalendarItem[]; sessions: Map<number, SessionDetail> }> {
  const [all, goals] = await Promise.all([sessionsOf(), listGoals()]);
  const names = new Map(goals.map((g) => [g.id, g.title]));
  const inRange = all.filter((s) => s.start < to && s.end > from);
  const key = (s: (typeof all)[number]) => `${s.goalId}|${s.start.getTime()}`;
  const replaced = new Set(inRange.filter((s) => s.status !== "skipped").map(key));
  const shown = new Set<string>();
  const items: CalendarItem[] = [];
  const sessions = new Map<number, SessionDetail>();
  for (const s of inRange) {
    if (s.status !== "skipped" || s.outlookEventId || replaced.has(key(s)) || shown.has(key(s))) continue;
    shown.add(key(s));
    const id = syntheticId(s.id);
    items.push({ id, title: s.title, start: s.start, end: s.end, allDay: false, kind: "event" });
    sessions.set(id, { ...sessionJson(s), goal: names.get(s.goalId) ?? null });
  }
  return { items, sessions };
}
