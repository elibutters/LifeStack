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
// calendar altogether, and so would one that was marked done after being skipped. These put them back as items of their own (a skipped one
// struck through and marked Skipped). A skipped session whose event could
// not be removed is still an Outlook item (and already marked by the join above), and one that was replaced by a session at the same time is
// not shown: the replacement stands for it. A session dropped because the plan changed is "replaced", not skipped, and is never shown.
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
    // A session with no event of its own: a skipped one (its event was taken off), or one that was marked done afterwards.
    const wanted = s.status === "skipped" ? !replaced.has(key(s)) : s.status === "done";
    if (!wanted || s.outlookEventId || shown.has(key(s))) continue;
    shown.add(key(s));
    const id = syntheticId(s.id);
    items.push({ id, title: s.title, start: s.start, end: s.end, allDay: false, kind: "event" });
    sessions.set(id, { ...sessionJson(s), goal: names.get(s.goalId) ?? null });
  }
  return { items, sessions };
}
