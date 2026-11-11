import "server-only";
import { z } from "zod";
import * as eng from "./goals-core";
import { listGoals, loadConstraints, patchPayload, refreshCalendar, sessionJson, sessionRow, sessionsOf, type CalendarState } from "./goals";
import { updateEvent } from "./outlook-write";
import { describeMove, parseWhen, sessionState } from "./session-log-core";

// For an agent that is told what already happened ("I did yesterday's legs lift at noon today"). The pure rules are in session-log-core.ts.

const Log = z.object({
  start: z.string().min(1),
  minutes: z.number().int().min(1).max(720).optional(),
  note: z.string().trim().max(1000).optional(),
  rating: z.number().int().min(1).max(5).optional(),
});

// Records that a session was done, at the time it was really done. It moves the session (and its calendar event) to the real start, remembers
// the planned time in movedFrom, and marks it done in one step. Unlike move_session it never refuses an overlap: this is a record of the past,
// not a plan, so a meeting that happened at the same time does not make it untrue. Planned and skipped sessions can be logged; a session that is
// already done can be logged again to correct its time. A replaced session (dropped when the plan changed) cannot.
export async function logSession(id: string, input: unknown, now = new Date()) {
  const s = await sessionRow(id);
  if (!s) return { ok: false as const, error: "No such session." };
  if (s.status === "replaced") return { ok: false as const, error: "That session was dropped when the plan changed. Log the session that replaced it instead." };
  const p = Log.safeParse(input);
  if (!p.success) return { ok: false as const, error: p.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ") };
  const c = await loadConstraints();
  const start = parseWhen(p.data.start, c.tz);
  if (!start) return { ok: false as const, error: "start is not a valid time. Use an ISO time with an offset (2026-11-11T12:00:00-05:00), or a local time with no offset (2026-11-11T12:00) which counts as the owner's own time zone." };
  if (start.getTime() > now.getTime() + 5 * 60000) return { ok: false as const, error: "start is in the future. log_session records something already done; to plan a later time use move_session." };
  const end = new Date(start.getTime() + s.durationMin * 60000); // the planned length, so the calendar block keeps its shape
  const minutes = p.data.minutes ?? s.durationMin;
  const finished = new Date(Math.min(start.getTime() + minutes * 60000, now.getTime()));
  const moved = Math.abs(start.getTime() - s.start.getTime()) > 60000;
  const cal = s.outlookEventId ? await updateEvent(s.outlookEventId, { start, end }) : null;
  await patchPayload(`session:${id}`, {
    end: end.toISOString(), day: eng.localDay(start, c.tz), doneAt: finished.toISOString(), minutes, skippedAt: null,
    ...(moved ? { movedFrom: [...s.movedFrom, s.start.toISOString()].slice(-10) } : {}),
    ...(p.data.note ? { logNote: p.data.note } : {}), ...(p.data.rating ? { rating: p.data.rating } : {}),
  }, { ts: start, valueText: "done" });
  if (cal && cal.ok) refreshCalendar();
  const after = (await sessionRow(id))!;
  return {
    ok: true as const,
    summary: describeMove({ title: s.title, from: moved ? s.start : null, to: start, minutes, tz: c.tz, wasDone: s.status === "done" }),
    calendar: (cal ? (cal.ok ? "ok" : cal.reason) : "skipped") as CalendarState,
    session: sessionJson(after),
  };
}

// Sessions in a window of local days, a short row each, so an agent can find the id it needs in one call rather than reading every goal in full.
// `state` is what the owner would call it: planned, done, skipped, or missed (planned and over more than an hour ago with nothing logged).
const Find = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  state: z.enum(["planned", "done", "skipped", "missed", "replaced"]).optional(),
  goalId: z.string().optional(),
});
export async function findSessions(input: unknown, now = new Date()) {
  const p = Find.safeParse(input ?? {});
  if (!p.success) return { ok: false as const, error: p.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ") };
  const c = await loadConstraints();
  const today = eng.localDay(now, c.tz);
  const from = p.data.from ?? eng.addDay(today, -7);
  const to = p.data.to ?? eng.addDay(today, 14);
  if (to < from) return { ok: false as const, error: "'to' is before 'from'." };
  if (eng.daysBetween(from, to) > 90) return { ok: false as const, error: "The window is limited to 90 days." };
  const lo = eng.localToDate(from, 0, c.tz), hi = eng.localToDate(eng.addDay(to, 1), 0, c.tz);
  const goals = new Map((await listGoals()).map((g) => [g.id, g.title]));
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: c.tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const rows = (await sessionsOf(p.data.goalId, now))
    .filter((s) => s.start >= lo && s.start < hi)
    .map((s) => ({ s, state: sessionState(s, now) }))
    .filter((r) => (p.data.state ? r.state === p.data.state : r.state !== "replaced"))
    .slice(0, 100)
    .map(({ s, state }) => ({ id: s.id, goal: goals.get(s.goalId) ?? null, goalId: s.goalId, title: s.title, state, when: fmt.format(s.start), start: s.start.toISOString(), end: s.end.toISOString(), minutes: s.durationMin, doneAt: s.doneAt, moved: s.movedFrom.length > 0, onCalendar: !!s.outlookEventId }));
  return { ok: true as const, timeZone: c.tz, from, to, sessions: rows };
}
