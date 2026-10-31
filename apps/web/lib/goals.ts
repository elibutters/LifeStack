import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, gte, like, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { events } from "@lifestack/db";
import { db } from "./db";
import { TZ } from "./dates";
import { describeError } from "./errors";
import * as eng from "./goals-core";
import { notebookUrl } from "./goals-notion-core";
import { after } from "next/server";
import { loadActivity } from "./activities";
import { syncOutlook } from "./outlook";
import { createEvents, deleteEvent, updateEvent, type SessionEvent } from "./outlook-write";
import { loadOverrides } from "./settings-store";
import { actualLine, completes, stravaUrl, type Actual } from "./strava-link-core";
import { verifyBearer } from "./tokens";
import { resolveAll, valueOf, type GoalScheduleT } from "./settings-core";

// Goals and their sessions, kept in the events table (source "goals") so they are backed up and need no migration of their own:
//   goal    -> domain "goal", key "goal.def",     source_id "goal:<id>",    payload holds the definition
//   session -> domain "goal", key "goal.session", source_id "session:<id>", ts is the start, value_text the status, value_num the minutes
// The scheduling rules are in goals-core.ts; this file is storage, the calendar and the actions on a session.
const SRC = "goals";
export const GOAL_KINDS = ["prep", "progress", "train", "custom"] as const;
export const GOAL_MODES = ["ask", "slide", "auto"] as const; // what happens when a session slips; "ask" never moves anything on its own
export const GOAL_STATUSES = ["draft", "active", "done", "archived"] as const;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "not a real date");
export const GoalInput = z.object({
  title: z.string().trim().min(1).max(120),
  thesis: z.string().trim().max(2000).default(""),
  kind: z.enum(GOAL_KINDS).default("custom"),
  targetDay: Day.optional(),
  mode: z.enum(GOAL_MODES).default("ask"),
  config: z.record(z.string(), z.unknown()).default({}),
});
export const GoalPatch = z.object({ title: z.string().trim().min(1).max(120), thesis: z.string().trim().max(2000), kind: z.enum(GOAL_KINDS), targetDay: Day.nullable(), mode: z.enum(GOAL_MODES), status: z.enum(GOAL_STATUSES), config: z.record(z.string(), z.unknown()), notionPageId: z.string().max(100).nullable() }).partial().refine((o) => Object.keys(o).length > 0, "nothing to change");

export type Goal = { id: string; title: string; thesis: string; kind: (typeof GOAL_KINDS)[number]; targetDay: string | null; mode: (typeof GOAL_MODES)[number]; status: (typeof GOAL_STATUSES)[number]; config: Record<string, unknown>; notionPageId: string | null; createdAt: string };
export type SessionStatus = "planned" | "done" | "skipped";
export type Session = { id: string; goalId: string; title: string; start: Date; end: Date; durationMin: number; status: SessionStatus; day: string; note: string | null; outlookEventId: string | null; movedFrom: string[]; doneAt: string | null; minutes: number | null; rating: number | null; actual: Actual | null };

const newId = (prefix: string) => `${prefix}${randomBytes(4).toString("hex")}`;
type Row = typeof events.$inferSelect;
const rec = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

function goalOf(r: Row): Goal {
  const p = rec(r.payload);
  return {
    id: String(p.id), title: String(p.title ?? ""), thesis: String(p.thesis ?? ""), kind: (p.kind as Goal["kind"]) ?? "custom", targetDay: typeof p.targetDay === "string" ? p.targetDay : null,
    mode: (p.mode as Goal["mode"]) ?? "ask", status: (p.status as Goal["status"]) ?? "draft", config: rec(p.config), notionPageId: typeof p.notionPageId === "string" ? p.notionPageId : null, createdAt: String(p.createdAt ?? r.ts.toISOString()),
  };
}

function actualOf(v: unknown): Actual | null {
  const a = rec(v);
  if (typeof a.id !== "number" || typeof a.start !== "string") return null;
  const num = (x: unknown) => (typeof x === "number" ? x : null);
  return { id: a.id, name: typeof a.name === "string" ? a.name : null, sport: typeof a.sport === "string" ? a.sport : "Workout", distanceM: num(a.distanceM), movingS: num(a.movingS), avgHr: num(a.avgHr), start: a.start };
}

function sessionOf(r: Row): Session {
  const p = rec(r.payload);
  const end = new Date(String(p.end));
  return {
    id: r.sourceId!.slice("session:".length), goalId: String(p.goalId), title: String(p.title ?? ""), start: r.ts, end, durationMin: Math.round((end.getTime() - r.ts.getTime()) / 60000),
    status: (r.valueText as SessionStatus) ?? "planned", day: typeof p.day === "string" ? p.day : eng.localDay(r.ts, TZ), note: typeof p.note === "string" ? p.note : null,
    outlookEventId: typeof p.outlookEventId === "string" ? p.outlookEventId : null, movedFrom: Array.isArray(p.movedFrom) ? p.movedFrom.map(String) : [],
    doneAt: typeof p.doneAt === "string" ? p.doneAt : null, minutes: typeof p.minutes === "number" ? p.minutes : null, rating: typeof p.rating === "number" ? p.rating : null, actual: actualOf(p.actual),
  };
}

// ---- schedule rules (the goals.schedule preference)
const clock = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
export function toConstraints(s: GoalScheduleT, tz = TZ): eng.Constraints {
  return {
    tz,
    weekdayHours: s.weekday.map(([a, b]) => [clock(a), clock(b)] as eng.Hours),
    weekendHours: s.weekend.map(([a, b]) => [clock(a), clock(b)] as eng.Hours),
    latestEndMin: clock(s.latestEnd),
    maxPerDay: s.maxPerDay,
    bufferMin: s.bufferMin,
    preferredStartMin: clock(s.preferredStart),
  };
}
export async function loadConstraints(): Promise<eng.Constraints> {
  return toConstraints(valueOf(resolveAll(await loadOverrides()), "goals.schedule"));
}

// ---- goals
export async function createGoal(input: unknown): Promise<{ ok: true; goal: Goal } | { ok: false; error: string }> {
  const p = GoalInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ") };
  const id = newId("g");
  const payload = { id, ...p.data, status: "draft", notionPageId: null, createdAt: new Date().toISOString() };
  await db().insert(events).values({ ts: new Date(), domain: "goal", key: "goal.def", valueText: p.data.title, payload, source: SRC, sourceId: `goal:${id}` });
  return { ok: true, goal: goalOf((await rowOf(`goal:${id}`))!) };
}

async function rowOf(sourceId: string): Promise<Row | null> {
  const [r] = await db().select().from(events).where(and(eq(events.source, SRC), eq(events.sourceId, sourceId)));
  return r ?? null;
}

const patchPayload = (sourceId: string, patch: Record<string, unknown>, extra: Partial<typeof events.$inferInsert> = {}) =>
  db().update(events).set({ payload: sql`${events.payload} || ${JSON.stringify(patch)}::jsonb`, ...extra }).where(and(eq(events.source, SRC), eq(events.sourceId, sourceId)));

export async function updateGoal(id: string, patch: unknown): Promise<{ ok: true; goal: Goal } | { ok: false; error: string }> {
  const p = GoalPatch.safeParse(patch);
  if (!p.success) return { ok: false, error: p.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ") };
  if (!(await rowOf(`goal:${id}`))) return { ok: false, error: "No such goal." };
  await patchPayload(`goal:${id}`, p.data, p.data.title ? { valueText: p.data.title } : {});
  return { ok: true, goal: goalOf((await rowOf(`goal:${id}`))!) };
}

export async function listGoals(): Promise<Goal[]> {
  const rows = await db().select().from(events).where(and(eq(events.source, SRC), eq(events.key, "goal.def"))).orderBy(asc(events.ts));
  return rows.map(goalOf);
}

export async function sessionsOf(goalId?: string): Promise<Session[]> {
  const rows = await db().select().from(events).where(and(eq(events.source, SRC), eq(events.key, "goal.session"), goalId ? sql`${events.payload}->>'goalId' = ${goalId}` : undefined)).orderBy(asc(events.ts));
  return rows.map(sessionOf);
}

export async function getGoal(id: string) {
  const r = await rowOf(`goal:${id}`);
  if (!r) return null;
  const goal = goalOf(r);
  const sessions = await sessionsOf(id);
  const done = sessions.filter((s) => s.status === "done");
  const next = sessions.find((s) => s.status === "planned" && s.end > new Date()) ?? null;
  return { goal, notebook: goal.notionPageId ? notebookUrl(goal.notionPageId) : null, sessions: sessions.map(sessionJson), progress: { planned: sessions.filter((s) => s.status === "planned").length, done: done.length, skipped: sessions.filter((s) => s.status === "skipped").length, minutesDone: done.reduce((n, s) => n + (s.minutes ?? s.durationMin), 0) }, next: next && sessionJson(next) };
}

export const sessionJson = (s: Session) => ({ id: s.id, goalId: s.goalId, title: s.title, start: s.start.toISOString(), end: s.end.toISOString(), minutes: s.durationMin, status: s.status, note: s.note, onCalendar: !!s.outlookEventId, movedFrom: s.movedFrom, doneAt: s.doneAt, minutesSpent: s.minutes, rating: s.rating, actual: s.actual && { ...s.actual, summary: actualLine(s.actual), url: stravaUrl(s.actual.id) } });

// ---- free time
// Meetings (not all-day events, not holidays) as busy time, leaving out the Outlook copies of Life Stack's own sessions: those are
// counted from the sessions themselves, so a session being moved never blocks its own new slot.
async function busyBetween(from: Date, to: Date, ownEventIds: Set<string>): Promise<eng.Interval[]> {
  const rows = await db().select().from(events).where(and(eq(events.source, "outlook"), eq(events.key, "calendar.event"), lt(events.ts, to), gte(events.ts, new Date(from.getTime() - 24 * 3_600_000))));
  const out: eng.Interval[] = [];
  for (const r of rows) {
    const p = rec(r.payload);
    if (p.allDay === true || p.kind === "holiday" || (r.sourceId && ownEventIds.has(r.sourceId))) continue;
    const end = new Date(String(p.end));
    if (!Number.isNaN(end.getTime()) && end > from) out.push({ start: r.ts, end });
  }
  return out;
}

async function context(from: Date, to: Date, excludeSessionId?: string) {
  const [c, all] = await Promise.all([loadConstraints(), sessionsOf()]);
  const planned = all.filter((s) => s.status === "planned" && s.id !== excludeSessionId);
  const own = new Set(all.map((s) => s.outlookEventId).filter((x): x is string => !!x));
  const busy = await busyBetween(from, to, own);
  const taken = planned.filter((s) => s.end > from && s.start < to).map((s) => ({ start: s.start, end: s.end }));
  return { c, busy, taken, planned };
}

export async function findFreeTime(o: { from: Date; to: Date; minMin?: number; now?: Date }) {
  const now = o.now ?? new Date();
  const { c, busy, taken } = await context(o.from, o.to);
  const free = eng.freeSlots(o.from, o.to, [...busy, ...taken], c, now, o.minMin ?? 30);
  return { free, constraints: c };
}

// ---- proposing a plan (changes nothing)
const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/); // HH:MM, local time
const Spec = z.object({
  kind: z.enum(["prep", "progress", "train", "custom"]),
  title: z.string().trim().min(1).max(120),
  fromDay: Day.optional(),
  targetDay: Day.optional(),
  everyDays: z.number().int().min(1).max(30).optional(),
  durationMin: z.number().int().min(10).max(480).optional(),
  taperLast: z.number().int().min(0).max(5).optional(),
  start: Clock.optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  weeks: z.number().int().min(1).max(40).optional(),
  note: z.string().trim().max(500).optional(), // goes on every session that has no note of its own
  template: z.array(z.object({ weekday: z.number().int().min(0).max(6), durationMin: z.number().int().min(10).max(480), title: z.string().trim().min(1).max(120), start: Clock.optional(), note: z.string().trim().max(500).optional() })).max(14).optional(),
  sessions: z.array(z.object({ day: Day, durationMin: z.number().int().min(10).max(480), title: z.string().trim().min(1).max(120), flexDays: z.number().int().min(0).max(7).optional(), start: Clock.optional(), note: z.string().trim().max(500).optional() })).max(120).optional(),
  flexDays: z.number().int().min(0).max(7).optional(),
});
export type PlanSpec = z.input<typeof Spec>;
const toMin = (hhmm?: string) => (hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) : undefined);

export function desiredFrom(spec: z.infer<typeof Spec>, today: string): { desired: eng.Desired[] } | { error: string } {
  const from = spec.fromDay ?? today;
  const target = spec.targetDay;
  const dur = spec.durationMin ?? 60;
  switch (spec.kind) {
    case "prep":
      if (!target) return { error: "A prep plan needs targetDay (the date it counts back from)." };
      return { desired: eng.cadence({ fromDay: from, targetDay: target, everyDays: spec.everyDays ?? 2, durationMin: dur, title: spec.title, taperLast: spec.taperLast ?? 0, flexDays: spec.flexDays, startMin: toMin(spec.start) }) };
    case "progress":
      if (!target) return { error: "A progress plan needs targetDay (the deadline)." };
      return { desired: eng.daily({ fromDay: from, toDay: target, durationMin: dur, title: spec.title, weekdays: spec.weekdays, flexDays: spec.flexDays, startMin: toMin(spec.start) }) };
    case "train": {
      if (!target || !spec.template?.length) return { error: "A training plan needs targetDay (race day) and a weekly template of {weekday, durationMin, title}." };
      const weeks = spec.weeks ?? Math.max(1, Math.ceil((eng.daysBetween(from, target) + 1) / 7));
      return { desired: eng.weeklyPlan({ fromDay: from, toDay: eng.addDay(target, -1), template: spec.template.map((t) => ({ weekday: t.weekday, durationMin: t.durationMin, title: t.title, startMin: toMin(t.start), note: t.note })), multipliers: eng.trainingMultipliers(weeks), flexDays: spec.flexDays }) };
    }
    default:
      if (!spec.sessions?.length) return { error: "A custom plan needs sessions: a list of {day, durationMin, title}." };
      return { desired: spec.sessions.map((s) => ({ day: s.day, durationMin: s.durationMin, title: s.title, flexDays: s.flexDays ?? spec.flexDays ?? 1, startMin: toMin(s.start) ?? toMin(spec.start), note: s.note })) };
  }
}

export async function proposePlan(input: unknown, now = new Date()) {
  const p = Spec.safeParse(input);
  if (!p.success) return { ok: false as const, error: p.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ") };
  const { c } = await context(now, now);
  const today = eng.localDay(now, c.tz);
  const d = desiredFrom(p.data, today);
  if ("error" in d) return { ok: false as const, error: d.error };
  if (p.data.note) d.desired = d.desired.map((x) => ({ ...x, note: x.note ?? p.data.note }));
  if (d.desired.length === 0) return { ok: false as const, error: "That produces no sessions. Check the dates." };
  if (d.desired.length > 120) return { ok: false as const, error: "That is more than 120 sessions. Narrow it down." };
  const last = d.desired.reduce((m, x) => (x.day > m ? x.day : m), today);
  const from = eng.localToDate(today, 0, c.tz);
  const to = eng.localToDate(eng.addDay(last, 3), 0, c.tz);
  const ctx = await context(from, to);
  const free = eng.freeSlots(from, to, [...ctx.busy, ...ctx.taken], c, now, 15);
  const placed = eng.place(d.desired, free, c, ctx.taken);
  return {
    ok: true as const,
    sessions: placed.placed.map((x) => ({ title: x.title, start: x.start.toISOString(), end: x.end.toISOString(), day: x.placedDay, shiftedDays: x.shiftedDays, minutes: x.durationMin, ...(x.note ? { note: x.note } : {}) })),
    unplaced: placed.unplaced.map((u) => ({ title: u.desired.title, day: u.desired.day, minutes: u.desired.durationMin, reason: u.reason })),
    feasibility: eng.feasibility(d.desired, free),
  };
}

// ---- committing a plan
const Commit = z.object({
  sessions: z.array(z.object({ title: z.string().trim().min(1).max(200), start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }), note: z.string().trim().max(500).optional() })).min(1).max(120),
  allowOverlap: z.boolean().optional(),
});
export type CalendarState = "ok" | "not_connected" | "needs_reconnect" | "failed" | "skipped";

export async function commitPlan(goalId: string, input: unknown, now = new Date()) {
  const goalRow = await rowOf(`goal:${goalId}`);
  if (!goalRow) return { ok: false as const, error: "No such goal." };
  const p = Commit.safeParse(input);
  if (!p.success) return { ok: false as const, error: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const goal = goalOf(goalRow);
  const list = p.data.sessions.map((s) => ({ ...s, startD: new Date(s.start), endD: new Date(s.end) }));
  for (const s of list) {
    if (!(s.endD > s.startD)) return { ok: false as const, error: `"${s.title}" ends before it starts.` };
    if ((s.endD.getTime() - s.startD.getTime()) / 60000 > 12 * 60) return { ok: false as const, error: `"${s.title}" is longer than 12 hours.` };
    if (s.endD.getTime() < now.getTime() - 3_600_000) return { ok: false as const, error: `"${s.title}" is in the past.` };
    if (s.startD.getTime() > now.getTime() + 400 * 86_400_000) return { ok: false as const, error: `"${s.title}" is more than a year away.` };
  }
  const from = new Date(Math.min(...list.map((s) => s.startD.getTime())));
  const to = new Date(Math.max(...list.map((s) => s.endD.getTime())));
  const ctx = await context(from, to);
  const conflicts: { title: string; start: string; with: string }[] = [];
  if (!p.data.allowOverlap) {
    const blockers = [...ctx.busy.map((b) => ({ ...b, what: "a meeting" })), ...ctx.taken.map((t) => ({ ...t, what: "another session" }))];
    list.forEach((s, i) => {
      for (const b of blockers) if (s.startD < b.end && s.endD > b.start) conflicts.push({ title: s.title, start: s.start, with: b.what });
      for (const o of list.slice(i + 1)) if (s.startD < o.endD && s.endD > o.startD) conflicts.push({ title: s.title, start: s.start, with: `"${o.title}" in this plan` });
    });
    if (conflicts.length) return { ok: false as const, error: "Some sessions overlap something already on the calendar. Nothing was saved.", conflicts };
  }
  const base = eng.localDay(now, ctx.c.tz).replaceAll("-", "");
  const made = list.map((s) => ({ ...s, id: `${goalId}-${base}-${randomBytes(3).toString("hex")}` }));
  // The calendar first: if Outlook is not ready the sessions are still saved here, without an event, and can be pushed later.
  const cal = await createEvents(made.map((s) => ({ key: `${s.id}`, title: s.title, start: s.startD, end: s.endD, body: eventBody(goal, s.note) })));
  const ids = new Map(cal.ok ? cal.value.map((v) => [v.key, v.id]) : []);
  for (const s of made) {
    await db().insert(events).values({
      ts: s.startD, domain: "goal", key: "goal.session", valueNum: (s.endD.getTime() - s.startD.getTime()) / 60000, valueText: "planned",
      payload: { goalId, title: s.title, end: s.endD.toISOString(), day: eng.localDay(s.startD, ctx.c.tz), ...(s.note ? { note: s.note } : {}), ...(ids.has(s.id) ? { outlookEventId: ids.get(s.id) } : {}) },
      source: SRC, sourceId: `session:${s.id}`,
    });
  }
  if (goal.status === "draft") await patchPayload(`goal:${goalId}`, { status: "active" });
  if (cal.ok) refreshCalendar();
  return { ok: true as const, saved: made.length, calendar: (cal.ok ? "ok" : cal.reason) as CalendarState, sessions: (await sessionsOf(goalId)).filter((s) => made.some((m) => m.id === s.id)).map(sessionJson) };
}

// After Outlook has been written to, copy the calendar back so the site shows the change now rather than at the next daily sync.
// Runs after the response when in a request, otherwise in the background. Never throws.
function refreshCalendar() {
  const run = () => syncOutlook().catch(() => {});
  try {
    after(run);
  } catch {
    void run();
  }
}

const eventBody = (g: Goal, note?: string | null, actual?: Actual | null) =>
  [`Goal: ${g.title}`, g.thesis ? g.thesis.slice(0, 500) : "", note ?? "", actual ? actualLine(actual) : "", actual ? stravaUrl(actual.id) : ""].filter(Boolean).join("\n");

// Sessions saved before Outlook was ready (or whose event failed) get their calendar events now.
export async function pushToCalendar(goalId?: string, now = new Date()) {
  const goals = new Map((await listGoals()).map((g) => [g.id, g]));
  const todo = (await sessionsOf(goalId)).filter((s) => s.status === "planned" && !s.outlookEventId && s.end > now);
  if (todo.length === 0) return { calendar: "ok" as CalendarState, pushed: 0 };
  const cal = await createEvents(todo.map((s) => ({ key: s.id, title: s.title, start: s.start, end: s.end, body: eventBody(goals.get(s.goalId) ?? ({ title: "", thesis: "" } as Goal), s.note, s.actual) })));
  if (!cal.ok) return { calendar: cal.reason as CalendarState, pushed: 0 };
  for (const v of cal.value) await patchPayload(`session:${v.key}`, { outlookEventId: v.id });
  refreshCalendar();
  return { calendar: "ok" as CalendarState, pushed: cal.value.length };
}

// ---- acting on a session
async function sessionRow(id: string) {
  const r = await rowOf(`session:${id}`);
  return r ? sessionOf(r) : null;
}

const Done = z.object({ minutes: z.number().int().min(1).max(720).optional(), note: z.string().trim().max(1000).optional(), rating: z.number().int().min(1).max(5).optional() });
export async function completeSession(id: string, input: unknown = {}, now = new Date()) {
  const s = await sessionRow(id);
  if (!s) return { ok: false as const, error: "No such session." };
  const p = Done.safeParse(input ?? {});
  if (!p.success) return { ok: false as const, error: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  await patchPayload(`session:${id}`, { doneAt: now.toISOString(), ...(p.data.minutes ? { minutes: p.data.minutes } : {}), ...(p.data.note ? { logNote: p.data.note } : {}), ...(p.data.rating ? { rating: p.data.rating } : {}) }, { valueText: "done" });
  return { ok: true as const, session: sessionJson((await sessionRow(id))!) };
}

const NoteBody = z.object({ note: z.string().trim().max(1000) });
// Replaces a session's note (empty clears it) here and in the Outlook event body, so notes can be added or corrected after the plan was
// committed, such as how a workout went. The session's status and time are untouched.
export async function setSessionNote(id: string, input: unknown) {
  const s = await sessionRow(id);
  if (!s) return { ok: false as const, error: "No such session." };
  const p = NoteBody.safeParse(input);
  if (!p.success) return { ok: false as const, error: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const note = p.data.note || null;
  await patchPayload(`session:${id}`, { note });
  const goal = (await listGoals()).find((g) => g.id === s.goalId);
  const cal = s.outlookEventId ? await updateEvent(s.outlookEventId, { body: eventBody(goal ?? ({ title: "", thesis: "" } as Goal), note, s.actual) }) : null;
  if (cal && cal.ok) refreshCalendar();
  return { ok: true as const, calendar: (cal ? (cal.ok ? "ok" : cal.reason) : "skipped") as CalendarState, session: sessionJson((await sessionRow(id))!) };
}

// Attaches a Strava activity to a session (or detaches it with null): the actual run is stored on the session, shown in the goal and written
// into the Outlook event body. An activity at least 70% of the planned minutes also marks a planned session done with the real minutes.
// `completed` tells the caller a session just became done, so it can log that to the goal's notebook.
export async function linkActivity(id: string, activityId: number | null) {
  const s = await sessionRow(id);
  if (!s) return { ok: false as const, error: "No such session." };
  let actual: Actual | null = null;
  if (activityId !== null) {
    const a = await loadActivity(activityId);
    if (!a || a.id === null) return { ok: false as const, error: "No such Strava activity. Use get_activities for an id." };
    const other = (await sessionsOf()).find((x) => x.actual?.id === activityId && x.id !== id);
    if (other) return { ok: false as const, error: `That activity is already linked to "${other.title}".` };
    actual = { id: a.id, name: a.name, sport: a.sport, distanceM: a.distanceM, movingS: a.movingS, avgHr: a.avgHr, start: a.start };
  }
  const done = !!actual && s.status === "planned" && completes(s.durationMin, actual.movingS);
  await patchPayload(`session:${id}`, { actual, ...(done ? { doneAt: new Date().toISOString(), minutes: Math.max(1, Math.round(actual!.movingS! / 60)) } : {}) }, done ? { valueText: "done" } : {});
  const goal = (await listGoals()).find((g) => g.id === s.goalId);
  const cal = s.outlookEventId ? await updateEvent(s.outlookEventId, { body: eventBody(goal ?? ({ title: "", thesis: "" } as Goal), s.note, actual) }) : null;
  if (cal && cal.ok) refreshCalendar();
  return { ok: true as const, completed: done, calendar: (cal ? (cal.ok ? "ok" : cal.reason) : "skipped") as CalendarState, session: sessionJson((await sessionRow(id))!) };
}

export async function skipSession(id: string) {
  const s = await sessionRow(id);
  if (!s) return { ok: false as const, error: "No such session." };
  // A skipped session comes off the calendar so it does not clutter it; the record stays.
  const cal = s.outlookEventId ? await deleteEvent(s.outlookEventId) : null;
  await patchPayload(`session:${id}`, cal && cal.ok ? { outlookEventId: null } : {}, { valueText: "skipped" });
  if (cal && cal.ok) refreshCalendar();
  return { ok: true as const, calendar: (cal ? (cal.ok ? "ok" : cal.reason) : "skipped") as CalendarState, session: sessionJson((await sessionRow(id))!) };
}

export async function moveSession(id: string, input: { start?: string } = {}, now = new Date()) {
  const s = await sessionRow(id);
  if (!s) return { ok: false as const, error: "No such session." };
  if (s.status !== "planned") return { ok: false as const, error: `That session is ${s.status}.` };
  const goal = (await listGoals()).find((g) => g.id === s.goalId);
  const horizon = new Date(now.getTime() + 21 * 86_400_000);
  const ctx = await context(now, horizon, id);
  let slot: eng.Interval | null;
  if (input.start) {
    const start = new Date(input.start);
    if (Number.isNaN(start.getTime())) return { ok: false as const, error: "start is not a valid time." };
    slot = { start, end: new Date(start.getTime() + s.durationMin * 60000) };
    const clash = [...ctx.busy, ...ctx.taken].find((b) => slot!.start < b.end && slot!.end > b.start);
    if (clash) return { ok: false as const, error: "That time overlaps a meeting or another session.", reason: "overlap" as const };
  } else {
    const free = eng.freeSlots(now, horizon, [...ctx.busy, ...ctx.taken], ctx.c, now, 15);
    slot = eng.reschedule({ durationMin: s.durationMin, free, c: ctx.c, existing: ctx.taken, now, lastDay: goal?.targetDay ?? undefined });
    if (!slot) return { ok: false as const, error: "There is no free slot before the goal's last day. Add time, drop a session, or move the date.", reason: "no_slot" as const };
  }
  const cal = s.outlookEventId ? await updateEvent(s.outlookEventId, { start: slot.start, end: slot.end }) : null;
  await patchPayload(`session:${id}`, { end: slot.end.toISOString(), day: eng.localDay(slot.start, ctx.c.tz), movedFrom: [...s.movedFrom, s.start.toISOString()].slice(-10) }, { ts: slot.start });
  if (cal && cal.ok) refreshCalendar();
  return { ok: true as const, calendar: (cal ? (cal.ok ? "ok" : cal.reason) : "skipped") as CalendarState, session: sessionJson((await sessionRow(id))!) };
}

// ---- tonight
// What is on today, plus anything that slipped and needs a decision, each with the slot it would move to.
export async function tonight(now = new Date()) {
  const c = await loadConstraints();
  const today = eng.localDay(now, c.tz);
  const start = eng.localToDate(today, 0, c.tz);
  const end = eng.localToDate(eng.addDay(today, 1), 0, c.tz);
  const all = await sessionsOf();
  const todays = all.filter((s) => s.start >= start && s.start < end && s.status !== "skipped").map(sessionJson);
  const missed = all.filter((s) => eng.statusAt({ status: s.status, end: s.end }, now) === "missed");
  const ctx = await context(now, new Date(now.getTime() + 21 * 86_400_000));
  const free = eng.freeSlots(now, new Date(now.getTime() + 21 * 86_400_000), [...ctx.busy, ...ctx.taken], c, now, 15);
  const goals = new Map((await listGoals()).map((g) => [g.id, g]));
  const needsDecision = missed.map((s) => {
    const g = goals.get(s.goalId);
    const slot = eng.reschedule({ durationMin: s.durationMin, free, c, existing: ctx.taken.filter((t) => t.start.getTime() !== s.start.getTime()), now, lastDay: g?.targetDay ?? undefined });
    return { session: sessionJson(s), goal: g?.title ?? null, mode: g?.mode ?? "ask", suggestion: slot ? { start: slot.start.toISOString(), end: slot.end.toISOString() } : null };
  });
  const freeToday = free.filter((f) => f.start < end).reduce((n, f) => n + (Math.min(f.end.getTime(), end.getTime()) - f.start.getTime()) / 60000, 0);
  return { today, sessions: todays, needsDecision, freeMinutesLeftToday: Math.round(freeToday) };
}

// ---- API (/api/v1/goals*): read with goals:read, change with goals:write
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
async function guarded(req: Request, scope: "goals:read" | "goals:write", fn: () => Promise<Response>): Promise<Response> {
  const auth = await verifyBearer(req.headers.get("authorization"), scope);
  if (!auth.ok) return json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, auth.status);
  try {
    return await fn();
  } catch (e) {
    console.error("goals: api failed", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}

export const handleGoals = (req: Request) =>
  guarded(req, "goals:read", async () => json({ goals: await Promise.all((await listGoals()).map(async (g) => (await getGoal(g.id))!)) }));
export const handleTonight = (req: Request) => guarded(req, "goals:read", async () => json(await tonight()));

const Action = z.discriminatedUnion("action", [
  Done.extend({ action: z.literal("done") }),
  z.object({ action: z.literal("skip") }),
  z.object({ action: z.literal("move"), start: z.iso.datetime({ offset: true }).optional() }),
  NoteBody.extend({ action: z.literal("note") }),
  z.object({ action: z.literal("link"), activityId: z.number().int().positive().nullable() }),
]);
export type SessionActionEvent = { action: "done" | "skip" | "move"; session: ReturnType<typeof sessionJson>; note?: string };
// `after` lets a caller (the route) do something once the action has succeeded, such as logging it to the goal's Notion notebook.
export const handleSessionAction = (req: Request, rawId: string, after?: (e: SessionActionEvent) => void) =>
  guarded(req, "goals:write", async () => {
    if (!/^[A-Za-z0-9-]{6,80}$/.test(rawId)) return json({ error: "not_found" }, 404);
    const text = await req.text();
    if (text.length > 4096) return json({ error: "too_large" }, 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return json({ error: "invalid_json" }, 400); }
    const a = Action.safeParse(body);
    if (!a.success) return json({ error: "invalid" }, 400);
    const act = a.data;
    const r = act.action === "done" ? await completeSession(rawId, act) : act.action === "skip" ? await skipSession(rawId) : act.action === "note" ? await setSessionNote(rawId, act) : act.action === "link" ? await linkActivity(rawId, act.activityId) : await moveSession(rawId, { start: act.start });
    if (r.ok) {
      if (act.action === "link") {
        if ("completed" in r && r.completed) after?.({ action: "done", session: r.session });
      } else if (act.action !== "note") after?.({ action: act.action, session: r.session, note: act.action === "done" ? act.note : undefined });
      return json(r);
    }
    return json({ error: "failed", message: r.error }, r.error === "No such session." ? 404 : 409);
  });
