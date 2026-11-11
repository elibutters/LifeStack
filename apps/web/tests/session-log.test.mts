// Logging a session done at the time it really happened, and finding sessions by day. Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
Object.assign(process.env, { MICROSOFT_CLIENT_ID: "cid", MICROSOFT_CLIENT_SECRET: "sec", ENCRYPTION_KEY: "ab".repeat(32), APP_URL: "https://app.example", APP_TZ: "America/New_York" });
const eng = await import("../lib/goals-core.ts");
const core = await import("../lib/session-log-core.ts");
const log = await import("../lib/session-log.ts");
const g = await import("../lib/goals.ts");
const { encrypt } = await import("../lib/crypto.ts");
const { db } = await import("../lib/db.ts");
const { events, connections, settings } = await import("@lifestack/db");

const TZ = "America/New_York";
const at = (day: string, min: number) => eng.localToDate(day, min, TZ);
const NOW = at("2026-11-11", 15 * 60); // Wednesday 3 PM

// ---- parseWhen: an offset is exact, no offset means the owner's own time, anything else is refused
assert.equal(core.parseWhen("2026-11-11T12:00", TZ)!.toISOString(), "2026-11-11T17:00:00.000Z", "no offset counts as the owner's local time (EST here)");
assert.equal(core.parseWhen("2026-11-11 12:00", TZ)!.toISOString(), "2026-11-11T17:00:00.000Z");
assert.equal(core.parseWhen("2026-07-04T12:00", TZ)!.toISOString(), "2026-07-04T16:00:00.000Z", "daylight saving is respected");
assert.equal(core.parseWhen("2026-11-11T12:00:00-05:00", TZ)!.toISOString(), "2026-11-11T17:00:00.000Z");
assert.equal(core.parseWhen("2026-11-11T17:00:00Z", TZ)!.toISOString(), "2026-11-11T17:00:00.000Z");
for (const bad of ["", "noon", "2026-11-11", "2026-02-31T10:00", "2026-13-01T10:00", "2026-11-11T25:00", "11/11/2026 12:00"]) assert.equal(core.parseWhen(bad, TZ), null, `refuses ${JSON.stringify(bad)}`);
assert.equal(core.describeMove({ title: "Lower", from: at("2026-11-10", 18 * 60 + 30), to: at("2026-11-11", 12 * 60), minutes: 60, tz: TZ, wasDone: false }), 'Marked done: "Lower" moved from Tue 6:30 PM to Wed 12:00 PM and logged as done (60 min).');
assert.match(core.describeMove({ title: "Run", from: null, to: at("2026-11-11", 10 * 60), minutes: 45, tz: TZ, wasDone: true }), /^Corrected: "Run" at Wed 10:00 AM \(45 min\)\.$/);

// ---- mock Microsoft
const calls: { method: string; url: string; body: string }[] = [];
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url; const u = new URL(url); const method = init.method ?? "GET";
  calls.push({ method, url, body: String(init.body ?? "") });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  if (u.pathname.endsWith("/token")) return json({ access_token: "at", refresh_token: "rt-next" });
  if (method === "PATCH") return json({ id: "x" });
  return json({ error: "unexpected" }, 500);
}) as typeof fetch;
const patches = () => calls.filter((c) => c.method === "PATCH");

const wipe = async () => { await db().delete(events); await db().delete(connections); await db().delete(settings); calls.length = 0; };
await wipe();
await db().insert(connections).values({ provider: "outlook", account: "me@example.com", refreshTokenEnc: encrypt("rt-start") });
const made = await g.createGoal({ title: "Lifting", kind: "train" }); assert.ok(made.ok); const goalId = (made as any).goal.id;
const session = (id: string, title: string, day: string, from: number, to: number, extra: Record<string, unknown> = {}, status = "planned") => db().insert(events).values({ ts: at(day, from), domain: "goal", key: "goal.session", valueText: status, payload: { goalId, title, end: at(day, to).toISOString(), day, movedFrom: [], ...extra }, source: "goals", sourceId: `session:${id}` });
await session("legs", "Lower (heavy)", "2026-11-10", 18 * 60 + 30, 19 * 60 + 30, { outlookEventId: "evt-legs" });   // yesterday, never done
await session("run1", "Easy run", "2026-11-11", 18 * 60, 18 * 60 + 40);                                              // today, planned, no calendar event
await session("later", "Upper A", "2026-11-12", 18 * 60, 19 * 60);
await session("gone", "Old plan", "2026-11-10", 7 * 60, 8 * 60, {}, "replaced");
// a real meeting at noon today: logging something that happened then must not be refused
await db().insert(events).values({ ts: at("2026-11-11", 12 * 60), domain: "calendar", key: "calendar.event", payload: { title: "Meeting", end: at("2026-11-11", 13 * 60).toISOString(), allDay: false, kind: "event" }, source: "outlook", sourceId: "mtg" });

// ---- finding sessions
const found = await log.findSessions({}, NOW) as any;
assert.ok(found.ok); assert.equal(found.timeZone, TZ);
assert.deepEqual(found.sessions.map((s: any) => [s.id, s.state]), [["legs", "missed"], ["run1", "planned"], ["later", "planned"]], "default window, replaced sessions left out, yesterday's unlogged lift shows as missed");
assert.equal(found.sessions[0].goal, "Lifting"); assert.equal(found.sessions[0].when, "Tue, Nov 10, 6:30 PM"); assert.equal(found.sessions[0].onCalendar, true);
assert.ok(!("note" in found.sessions[0]) && !("noteBlocks" in found.sessions[0]), "rows stay short");
assert.deepEqual(((await log.findSessions({ state: "missed" }, NOW)) as any).sessions.map((s: any) => s.id), ["legs"]);
assert.deepEqual(((await log.findSessions({ state: "replaced" }, NOW)) as any).sessions.map((s: any) => s.id), ["gone"], "replaced ones can be asked for");
assert.deepEqual(((await log.findSessions({ from: "2026-11-11", to: "2026-11-11" }, NOW)) as any).sessions.map((s: any) => s.id), ["run1"], "one local day");
assert.equal(((await log.findSessions({ from: "2026-11-12", to: "2026-11-11" }, NOW)) as any).ok, false); assert.equal(((await log.findSessions({ from: "2026-01-01", to: "2026-06-01" }, NOW)) as any).ok, false); assert.equal(((await log.findSessions({ from: "soon" }, NOW)) as any).ok, false);
assert.deepEqual(((await log.findSessions({ goalId: "gnope" }, NOW)) as any).sessions, []);

// ---- logging yesterday's lift at noon today, over a meeting
calls.length = 0;
const r = await log.logSession("legs", { start: "2026-11-11T12:00", note: "Squats felt good", rating: 4 }, NOW) as any;
assert.ok(r.ok, r.error);
assert.equal(r.session.status, "done"); assert.equal(r.session.start, at("2026-11-11", 12 * 60).toISOString(), "the session now sits at the real time");
assert.equal(r.session.minutes, 60, "the planned length is kept for the calendar block"); assert.equal(r.session.minutesSpent, 60);
assert.equal(r.session.rating, 4); assert.equal(((await db().select().from(events)).find((e) => e.sourceId === "session:legs")!.payload as any).logNote, "Squats felt good", "the note is stored");
assert.deepEqual(r.session.movedFrom, [at("2026-11-10", 18 * 60 + 30).toISOString()], "the planned time is remembered as a move");
assert.equal(r.session.doneAt, at("2026-11-11", 13 * 60).toISOString(), "done when it finished, not when it was recorded");
assert.match(r.summary, /moved from Tue 6:30 PM to Wed 12:00 PM/); assert.equal(r.calendar, "ok");
assert.equal(patches().length, 1); assert.deepEqual(Object.keys(JSON.parse(patches()[0]!.body)), ["start", "end"], "the calendar event follows");
assert.equal(((await g.sessionsOf(goalId, NOW)).find((s) => s.id === "legs")!).day, "2026-11-11", "it belongs to the day it was done");
assert.deepEqual(((await log.findSessions({ state: "done" }, NOW)) as any).sessions.map((s: any) => [s.id, s.moved]), [["legs", true]]);

// ---- an unmoved session is just marked done, with its own minutes; a long one still finishes by now
const r2 = await log.logSession("run1", { start: "2026-11-11T18:00:00-05:00", minutes: 50 }, at("2026-11-11", 19 * 60)) as any;
assert.ok(r2.ok); assert.deepEqual(r2.session.movedFrom, [], "same time, no move recorded"); assert.equal(r2.session.minutesSpent, 50);
assert.equal(r2.summary, 'Marked done: "Easy run" at Wed 6:00 PM (50 min).'); assert.equal(r2.calendar, "skipped", "no calendar event, nothing to move");
const r3 = await log.logSession("later", { start: "2026-11-11T14:30" }, NOW) as any;
assert.equal(r3.session.doneAt, NOW.toISOString(), "doneAt never lies in the future");

// ---- correcting a done session, and the refusals
const fix = await log.logSession("legs", { start: "2026-11-11T11:30", minutes: 55 }, NOW) as any;
assert.ok(fix.ok && /^Corrected/.test(fix.summary)); assert.equal(fix.session.movedFrom.length, 2, "each correction is remembered"); assert.equal(fix.session.minutesSpent, 55);
assert.equal(((await log.logSession("legs", { start: "2026-11-11T23:00" }, NOW)) as any).ok, false, "not in the future"); assert.match(((await log.logSession("legs", { start: "2026-11-11T23:00" }, NOW)) as any).error, /future/);
assert.match(((await log.logSession("legs", { start: "noon" }, NOW)) as any).error, /not a valid time/);
assert.equal(((await log.logSession("legs", { start: "2026-11-11T12:00", rating: 9 }, NOW)) as any).ok, false); assert.equal(((await log.logSession("legs", { start: "2026-11-11T12:00", minutes: 0 }, NOW)) as any).ok, false);
assert.match(((await log.logSession("gone", { start: "2026-11-10T07:00" }, NOW)) as any).error, /dropped/); assert.equal(((await log.logSession("nope", { start: "2026-11-11T12:00" }, NOW)) as any).ok, false);

// ---- skipped sessions can still be logged as done
await session("skipd", "Mobility", "2026-11-09", 18 * 60, 18 * 60 + 30, { skippedAt: "2026-11-09T23:30:00.000Z" }, "skipped");
const sk = await log.logSession("skipd", { start: "2026-11-11T09:00" }, NOW) as any;
assert.ok(sk.ok && sk.session.status === "done"); assert.equal((await g.sessionsOf(goalId, NOW)).find((s) => s.id === "skipd")!.skippedAt, null, "no longer counted as skipped");

await wipe();
console.log("session-log tests passed");
