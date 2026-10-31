// Goals: storage, free time, proposing a plan, committing it to Outlook (mocked), acting on sessions, tonight, and the API.
// Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
Object.assign(process.env, { MICROSOFT_CLIENT_ID: "cid", MICROSOFT_CLIENT_SECRET: "sec", ENCRYPTION_KEY: "ab".repeat(32), APP_URL: "https://app.example", APP_TZ: "America/New_York" });
const eng = await import("../lib/goals-core.ts");
const g = await import("../lib/goals.ts");
const store = await import("../lib/settings-store.ts");
const sc = await import("../lib/settings-core.ts");
const tok = await import("../lib/tokens.ts");
const cap = await import("../lib/capture-core.ts");
const { encrypt } = await import("../lib/crypto.ts");
const { db } = await import("../lib/db.ts");
const { events, connections, settings, apiTokens } = await import("@lifestack/db");

const TZ = "America/New_York";
const at = (day: string, min: number) => eng.localToDate(day, min, TZ);
const hm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
const NOW = at("2026-10-26", 8 * 60); // Monday morning

// ---- mock Microsoft
type Call = { method: string; url: string; body: string };
const calls: Call[] = []; let n = 0; let tokenMode: "ok" | "consent" = "ok";
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url; const u = new URL(url); const method = init.method ?? "GET";
  calls.push({ method, url, body: String(init.body ?? "") });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  if (u.pathname.endsWith("/token")) return tokenMode === "consent" ? json({ error: "consent_required" }, 400) : json({ access_token: "at", refresh_token: `rt-${++n}` });
  if (method === "POST" && u.pathname === "/v1.0/me/events") return json({ id: `evt-${++n}` }, 201);
  if (method === "PATCH") return json({ id: "x" });
  if (method === "DELETE") return new Response(null, { status: 204 });
  return json({ error: "unexpected" }, 500);
}) as typeof fetch;
const graph = (m: string) => calls.filter((c) => c.method === m && !c.url.includes("/token"));

const wipe = async () => { await db().delete(events); await db().delete(connections); await db().delete(settings); await db().delete(apiTokens); calls.length = 0; n = 0; tokenMode = "ok"; };
const connect = () => db().insert(connections).values({ provider: "outlook", account: "me@example.com", refreshTokenEnc: encrypt("rt-start") });
const meeting = (id: string, day: string, from: number, to: number) => db().insert(events).values({ ts: at(day, from), domain: "calendar", key: "calendar.event", payload: { title: "Meeting", end: at(day, to).toISOString(), allDay: false, kind: "event" }, source: "outlook", sourceId: id });

// ---- goals
await wipe();
assert.equal((await g.createGoal({ title: "  " })).ok, false); assert.equal((await g.createGoal({ title: "x", targetDay: "2026-13-45" })).ok, false);
assert.equal((await g.createGoal({ title: "x", kind: "nope" })).ok, false);
const made = await g.createGoal({ title: "Interview", thesis: "Be ready to talk through any case.", kind: "prep", targetDay: "2026-11-09" });
assert.ok(made.ok); const goal = (made as { goal: any }).goal;
assert.deepEqual([goal.status, goal.mode, goal.kind, goal.targetDay, goal.notionPageId], ["draft", "ask", "prep", "2026-11-09", null], "a new goal is a draft that asks before moving anything");
assert.match(goal.id, /^g[0-9a-f]{8}$/);
let up = await g.updateGoal(goal.id, { title: "Interview prep", mode: "slide" }); assert.ok(up.ok && (up as any).goal.title === "Interview prep" && (up as any).goal.mode === "slide");
assert.ok(((await g.updateGoal(goal.id, { targetDay: null })) as any).goal.targetDay === null); await g.updateGoal(goal.id, { targetDay: "2026-11-09" });
assert.equal((await g.updateGoal(goal.id, {})).ok, false); assert.equal((await g.updateGoal("gnope", { title: "x" })).ok, false); assert.equal((await g.updateGoal(goal.id, { mode: "wild" })).ok, false);
assert.equal((await g.listGoals()).length, 1);

// ---- the schedule setting
const defaults = sc.valueOf(sc.resolveAll({}), "goals.schedule");
const cons = g.toConstraints(defaults, TZ);
assert.deepEqual([cons.weekdayHours, cons.weekendHours, cons.latestEndMin, cons.maxPerDay, cons.bufferMin, cons.preferredStartMin], [[[1080, 1350]], [[540, 1260]], 1350, 2, 15, 1140], "weekday evenings, weekend days, 10:30pm latest, two a day");
assert.equal(sc.parseSetting("goals.schedule", { ...defaults, preferredStart: "7pm" }).ok, false); assert.equal(sc.parseSetting("goals.schedule", { ...defaults, maxPerDay: 0 }).ok, false); assert.equal(sc.parseSetting("goals.schedule", { ...defaults, extra: 1 }).ok, false);

// ---- free time and proposing a plan
await meeting("m-thu", "2026-10-29", 17 * 60, 23 * 60); await meeting("m-sun", "2026-11-01", 9 * 60, 10 * 60);
await db().insert(events).values({ ts: at("2026-10-28", 0), domain: "calendar", key: "calendar.event", payload: { title: "Holiday", end: at("2026-10-29", 0).toISOString(), allDay: true, kind: "holiday" }, source: "outlook", sourceId: "hol" });
const ff = await g.findFreeTime({ from: NOW, to: at("2026-10-30", 0), now: NOW });
assert.ok(ff.free.every((f) => hm(f.start) >= "18:00" && hm(f.end) <= "22:30"), "only inside the allowed hours");
assert.ok(!ff.free.some((f) => eng.localDay(f.start, TZ) === "2026-10-29"), "an all-evening meeting leaves nothing that day, and all-day holidays do not block");
assert.ok(ff.free.some((f) => eng.localDay(f.start, TZ) === "2026-10-28"));
const plan = { kind: "prep", title: "Interview prep", targetDay: "2026-11-09", everyDays: 2, durationMin: 60, taperLast: 2 } as const;
const prop = await g.proposePlan(plan, NOW);
assert.ok(prop.ok); const pr = prop as { sessions: any[]; unplaced: any[]; feasibility: any };
assert.equal(pr.sessions.length, 7); assert.equal(pr.unplaced.length, 0); assert.equal(pr.feasibility.shortMin, 0);
const thu = pr.sessions.find((s) => s.title.startsWith("Interview") && s.day === "2026-10-30");
assert.ok(thu && thu.shiftedDays === 1, "the session on the busy day moves to the next day");
assert.ok(pr.sessions.every((s) => hm(new Date(s.start)) >= "18:00"), "all in the evening on weekdays");
assert.deepEqual(pr.sessions.slice(-2).map((s) => s.minutes), [30, 30], "the last two are light");
assert.equal((await g.proposePlan({ kind: "prep", title: "x" }, NOW) as any).ok, false); assert.match(((await g.proposePlan({ kind: "prep", title: "x" }, NOW)) as any).error, /targetDay/);
assert.match(((await g.proposePlan({ kind: "train", title: "x", targetDay: "2026-12-01" }, NOW)) as any).error, /weekly template/);
assert.match(((await g.proposePlan({ kind: "custom", title: "x" }, NOW)) as any).error, /sessions/);
assert.equal((await g.proposePlan({ title: "x" }, NOW) as any).ok, false);
const train = await g.proposePlan({ kind: "train", title: "Run", targetDay: "2026-11-23", template: [{ weekday: 1, durationMin: 45, title: "Easy" }, { weekday: 5, durationMin: 90, title: "Long" }] }, NOW) as any;
assert.ok(train.ok && train.sessions.length >= 4, "a training block comes out of a weekly template");
const prog = await g.proposePlan({ kind: "progress", title: "YC", targetDay: "2026-10-30", durationMin: 45, weekdays: [0, 1, 2, 3, 4] }, NOW) as any;
assert.ok(prog.ok && prog.sessions.length >= 3, "daily progress toward a deadline");
const tooMuch = await g.proposePlan({ kind: "progress", title: "x", targetDay: "2026-10-28", durationMin: 480 }, NOW) as any;
assert.ok(tooMuch.ok && tooMuch.unplaced.length > 0 && tooMuch.feasibility.shortMin > 0, "an impossible plan says how short it is");
// a changed schedule changes the proposals
await store.putSetting("goals.schedule", { ...defaults, weekday: [["19:00", "20:30"]], maxPerDay: 1 });
const narrow = await g.proposePlan({ kind: "custom", title: "x", sessions: [{ day: "2026-10-27", durationMin: 120, title: "Deep work", flexDays: 0 }] }, NOW) as any;
assert.equal(narrow.unplaced.length, 1, "a two hour session does not fit a 90 minute window");
await store.deleteSetting("goals.schedule");

// ---- committing: Outlook not connected yet
const firstThree = pr.sessions.slice(0, 3).map((s) => ({ title: s.title, start: s.start, end: s.end, note: "Topics 1 to 3" }));
let cm = await g.commitPlan(goal.id, { sessions: firstThree }, NOW) as any;
assert.ok(cm.ok); assert.equal(cm.saved, 3); assert.equal(cm.calendar, "not_connected", "saved here even though Outlook is not connected");
assert.ok(cm.sessions.every((s: any) => !s.onCalendar && s.status === "planned"));
assert.equal(((await g.getGoal(goal.id)) as any).goal.status, "active", "committing makes the goal active");
assert.equal(calls.length, 0, "nothing was sent anywhere");
// connected but not approved for writing
await connect(); tokenMode = "consent";
assert.equal(((await g.pushToCalendar(goal.id, NOW)) as any).calendar, "needs_reconnect"); tokenMode = "ok";
// then pushed
const pushed = await g.pushToCalendar(goal.id, NOW) as any;
assert.deepEqual([pushed.calendar, pushed.pushed], ["ok", 3]);
assert.equal(graph("POST").length, 3); const body0 = JSON.parse(graph("POST")[0]!.body);
assert.deepEqual([body0.categories, body0.start.timeZone], [["Life Stack"], "UTC"]); assert.match(body0.body.content, /^Goal: Interview prep\n[\s\S]*\nPlan:\nTopics 1 to 3$/);
assert.ok((await g.sessionsOf(goal.id)).every((s) => !!s.outlookEventId), "every session now has its event id");
assert.deepEqual(await g.pushToCalendar(goal.id, NOW), { calendar: "ok", pushed: 0 }, "nothing left to push");

// ---- notes: set at planning time and editable after the plan was committed
const withNotes = await g.proposePlan({ kind: "custom", title: "Notes demo", note: "Default note", sessions: [{ day: "2026-11-04", durationMin: 30, title: "A", note: "Own note" }, { day: "2026-11-05", durationMin: 30, title: "B" }] }, NOW) as any;
assert.deepEqual(withNotes.sessions.map((x: any) => x.note), ["Own note", "Default note"], "a session note wins; the plan note fills the rest");
const trainNotes = await g.proposePlan({ kind: "train", title: "T", targetDay: "2026-11-16", weeks: 2, template: [{ weekday: 1, durationMin: 40, title: "Long", note: "Fuel at 45 min" }, { weekday: 3, durationMin: 30, title: "Easy" }] }, NOW) as any;
assert.ok(trainNotes.sessions.some((x: any) => x.title === "Long" && x.note === "Fuel at 45 min") && trainNotes.sessions.filter((x: any) => x.title === "Easy").every((x: any) => x.note === undefined), "template notes repeat on each occurrence");
const noteId = (await g.sessionsOf(goal.id))[0]!.id; const patches = graph("PATCH").length;
const n1 = await g.setSessionNote(noteId, { note: "Easy pace, 4 x 20s strides" }) as any;
assert.ok(n1.ok); assert.equal(n1.calendar, "ok"); assert.equal(n1.session.note, "Easy pace, 4 x 20s strides");
const p1 = JSON.parse(graph("PATCH").at(-1)!.body); assert.equal(graph("PATCH").length, patches + 1);
assert.match(p1.body.content, /^Goal: Interview prep\n[\s\S]*\nPlan:\nEasy pace, 4 x 20s strides$/); assert.equal(p1.start, undefined, "only the body changes");
const n2 = await g.setSessionNote(noteId, { note: "" }) as any; assert.equal(n2.session.note, null, "an empty note clears it");
assert.doesNotMatch(JSON.parse(graph("PATCH").at(-1)!.body).body.content, /strides/);
assert.equal(((await g.setSessionNote("snope-1234", { note: "x" })) as any).ok, false); assert.equal(((await g.setSessionNote(noteId, { note: "x".repeat(2001) })) as any).ok, false);
const n3 = await g.setSessionNote(noteId, { note: "Warm-up:\n- 5 min jog\nMain set:\n- 4 x 20s strides" }) as any;
assert.deepEqual(n3.session.noteBlocks.map((b: any) => b.kind), ["heading", "bullet", "heading", "bullet"], "the session carries its note as structured blocks");
assert.match(JSON.parse(graph("PATCH").at(-1)!.body).body.content, /\nPlan:\nWarm-up:\n- 5 min jog\n\nMain set:\n- 4 x 20s strides$/, "the calendar body shows the same structure");
const n4 = await g.setSessionNote(noteId, { note: "Main set:\n- 4 x 20s strides\nNotes:\n- Only if the toe feels fine" }) as any;
assert.deepEqual([n4.session.noteBlocks.length, n4.session.notesBlocks.map((b: any) => b.text)], [2, ["Only if the toe feels fine"]], "cautions come back separately from the plan");
assert.match(JSON.parse(graph("PATCH").at(-1)!.body).body.content, /\nPlan:\nMain set:\n- 4 x 20s strides\n\nNotes:\n- Only if the toe feels fine$/);
await g.setSessionNote(noteId, { note: "Original note" });

// ---- committing: conflicts and bad input
const clash = await g.commitPlan(goal.id, { sessions: [{ title: "Clash", start: at("2026-10-29", 18 * 60).toISOString(), end: at("2026-10-29", 19 * 60).toISOString() }] }, NOW) as any;
assert.equal(clash.ok, false); assert.equal(clash.conflicts[0].with, "a meeting"); assert.equal((await g.sessionsOf(goal.id)).length, 3, "a conflict saves nothing");
const own = (await g.sessionsOf(goal.id))[0]!;
const clash2 = await g.commitPlan(goal.id, { sessions: [{ title: "Clash", start: own.start.toISOString(), end: own.end.toISOString() }] }, NOW) as any;
assert.equal(clash2.conflicts[0].with, "another session");
assert.equal(((await g.commitPlan(goal.id, { sessions: [{ title: "A", start: at("2026-11-03", 19 * 60).toISOString(), end: at("2026-11-03", 20 * 60).toISOString() }, { title: "B", start: at("2026-11-03", 19 * 60 + 30).toISOString(), end: at("2026-11-03", 20 * 60 + 30).toISOString() }] }, NOW)) as any).conflicts[0].with, '"B" in this plan', "sessions in one plan cannot overlap each other");
const forced = await g.commitPlan(goal.id, { sessions: [{ title: "Forced", start: at("2026-10-29", 18 * 60).toISOString(), end: at("2026-10-29", 19 * 60).toISOString() }], allowOverlap: true }, NOW) as any;
assert.ok(forced.ok, "overlap is allowed when asked for"); const forcedId = forced.sessions[0].id;
const bad = (s: object) => g.commitPlan(goal.id, { sessions: [s] }, NOW) as Promise<any>;
assert.match((await bad({ title: "x", start: at("2026-11-03", 20 * 60).toISOString(), end: at("2026-11-03", 19 * 60).toISOString() })).error, /ends before/);
assert.match((await bad({ title: "x", start: at("2026-11-03", 1 * 60).toISOString(), end: at("2026-11-03", 14 * 60).toISOString() })).error, /longer than 12 hours/);
assert.match((await bad({ title: "x", start: at("2026-10-20", 19 * 60).toISOString(), end: at("2026-10-20", 20 * 60).toISOString() })).error, /in the past/);
assert.match((await bad({ title: "x", start: at("2028-01-03", 19 * 60).toISOString(), end: at("2028-01-03", 20 * 60).toISOString() })).error, /more than a year/);
assert.equal((await bad({ title: "", start: "x", end: "y" })).ok, false); assert.equal(((await g.commitPlan("gnope", { sessions: [] }, NOW)) as any).ok, false);

// ---- the calendar's copy of our own session never blocks it
const withEvent = (await g.sessionsOf(goal.id)).find((s) => s.id !== forcedId && s.outlookEventId)!;
await db().insert(events).values({ ts: withEvent.start, domain: "calendar", key: "calendar.event", payload: { title: withEvent.title, end: withEvent.end.toISOString(), allDay: false, kind: "event" }, source: "outlook", sourceId: withEvent.outlookEventId });
const nudge = new Date(withEvent.start.getTime() + 15 * 60000);
calls.length = 0;
const nudged = await g.moveSession(withEvent.id, { start: nudge.toISOString() }, NOW) as any;
assert.ok(nudged.ok, "moving a session over its own calendar copy is fine"); assert.equal(nudged.calendar, "ok");
assert.equal(graph("PATCH").length, 1); assert.deepEqual(Object.keys(JSON.parse(graph("PATCH")[0]!.body)), ["start", "end"], "the calendar event is moved, not rewritten");
assert.equal(nudged.session.movedFrom.length, 1); assert.equal(new Date(nudged.session.start).getTime(), nudge.getTime());
assert.equal(((await g.moveSession(withEvent.id, { start: at("2026-10-29", 18 * 60).toISOString() }, NOW)) as any).reason, "overlap", "but a real meeting still blocks it");
assert.equal(((await g.moveSession("snope", {}, NOW)) as any).ok, false); assert.equal(((await g.moveSession(withEvent.id, { start: "garbage" }, NOW)) as any).ok, false);

// ---- completing, skipping, and finding a new slot
const [s1, s2] = (await g.sessionsOf(goal.id)).filter((s) => s.id !== forcedId && s.id !== withEvent.id);
const done = await g.completeSession(s1!.id, { minutes: 70, note: "Covered cases 1 to 3", rating: 4 }, NOW) as any;
assert.ok(done.ok); assert.deepEqual([done.session.status, done.session.minutesSpent, done.session.rating], ["done", 70, 4]);
assert.equal(((await g.completeSession(s1!.id, { rating: 9 }, NOW)) as any).ok, false); assert.equal(((await g.completeSession("snope", {}, NOW)) as any).ok, false);
assert.equal(((await g.moveSession(s1!.id, {}, NOW)) as any).ok, false, "a finished session cannot be moved");
calls.length = 0;
const skipped = await g.skipSession(s2!.id) as any;
assert.ok(skipped.ok && skipped.session.status === "skipped" && !skipped.session.onCalendar, "a skipped session comes off the calendar"); assert.equal(graph("DELETE").length, 1);
const prog2 = ((await g.getGoal(goal.id)) as any).progress; assert.deepEqual([prog2.done, prog2.skipped, prog2.minutesDone], [1, 1, 70]);
const auto = await g.moveSession(forcedId, {}, NOW) as any;
assert.ok(auto.ok, "with no time given it picks the next free slot"); assert.ok(new Date(auto.session.start).getTime() >= NOW.getTime() + 30 * 60000);
const tight = (await g.createGoal({ title: "Tight", targetDay: "2026-10-26" }) as any).goal;
const noroom = await g.commitPlan(tight.id, { sessions: [{ title: "Late", start: at("2026-10-26", 20 * 60).toISOString(), end: at("2026-10-26", 21 * 60).toISOString() }] }, NOW) as any; assert.ok(noroom.ok);
const stuck = await g.moveSession(noroom.sessions[0].id, {}, at("2026-10-26", 21 * 60 + 40)) as any;
assert.deepEqual([stuck.ok, stuck.reason], [false, "no_slot"], "past the goal's last day it says so instead of moving it");
assert.match(stuck.error, /no free slot/i);

// ---- tonight
const ton = await g.tonight(at("2026-10-26", 23 * 60)) as any;
assert.equal(ton.today, "2026-10-26"); assert.equal(ton.sessions.length, 2, "the session moved to tonight and the late one are both on today's list");
assert.equal(ton.needsDecision.length, 2, "both ended over an hour ago with no Done, so both need a decision");
const lateOne = ton.needsDecision.find((d: any) => d.session.title === "Late"), movedOne = ton.needsDecision.find((d: any) => d.session.title === "Forced");
assert.deepEqual([lateOne.goal, lateOne.mode, lateOne.suggestion], ["Tight", "ask", null], "no suggestion when the goal's last day has passed");
assert.deepEqual([movedOne.goal, movedOne.mode], ["Interview prep", "slide"]); assert.ok(movedOne.suggestion && new Date(movedOne.suggestion.start) > at("2026-10-26", 23 * 60), "a goal with room gets the slot it would move to");
const ton2 = await g.tonight(at("2026-10-27", 12 * 60)) as any; assert.equal(ton2.today, "2026-10-27"); assert.ok(ton2.freeMinutesLeftToday > 0);

// ---- the API and permissions
const read = await tok.createToken("r", "agent", ["goals:read"]); const write = await tok.createToken("w", "agent", ["goals:write"]); const none = await tok.createToken("n", "agent", ["log:read"]);
const rq = (method: string, path: string, key: string | null, body?: unknown) => new Request(`http://localhost/api/v1/goals${path}`, { method, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
assert.equal((await g.handleGoals(rq("GET", "", null))).status, 401); assert.equal((await g.handleGoals(rq("GET", "", none.token))).status, 403); assert.equal((await g.handleGoals(rq("GET", "", write.token))).status, 403);
const list = await g.handleGoals(rq("GET", "", read.token)); assert.equal(list.status, 200); assert.equal(((await list.json()) as { goals: unknown[] }).goals.length, 2);
assert.equal((await g.handleTonight(rq("GET", "/tonight", read.token))).status, 200); assert.equal((await g.handleTonight(rq("GET", "/tonight", write.token))).status, 403);
const act = (id: string, body: unknown, key = write.token) => g.handleSessionAction(rq("POST", `/sessions/${id}`, key, body), id);
const todo = (await g.sessionsOf(goal.id)).find((s) => s.status === "planned")!;
assert.equal((await act(todo.id, { action: "done", minutes: 30 }, read.token)).status, 403, "reading is not changing");
assert.equal((await act(todo.id, { action: "note", note: "via api" }, read.token)).status, 403, "reading is not changing"); assert.equal((await act(todo.id, { action: "note", note: "via api" })).status, 200); assert.equal((await act(todo.id, { action: "note" })).status, 400);
assert.equal((await act(todo.id, { action: "dance" })).status, 400); assert.equal((await act(todo.id, "{nope")).status, 400); assert.equal((await act(todo.id, " ".repeat(5000))).status, 413);
assert.equal((await act("snope-1234", { action: "skip" })).status, 404); assert.equal((await act("bad id!", { action: "skip" })).status, 404);
assert.equal((await act(todo.id, { action: "done", minutes: 30, rating: 5 })).status, 200); assert.equal((await act(todo.id, { action: "move" })).status, 409, "moving a finished session is refused");
assert.ok(cap.AGENT_SCOPES.includes("goals:read") && cap.AGENT_SCOPES.includes("goals:write") && cap.APP_SCOPES.includes("goals:read") && cap.APP_SCOPES.includes("goals:write"), "agents and the phone can both use goals");

// ---- Strava: linking an activity to a session, by hand and automatically after a sync
const { sql } = await import("drizzle-orm");
const al = await import("../lib/strava-link.ts");
if (!(await db().select().from(connections)).length) await connect();
const rg = (await g.createGoal({ title: "Run goal", kind: "custom" }) as any).goal;
const rc = await g.commitPlan(rg.id, { sessions: [{ title: "Easy run", start: at("2026-11-10", 7 * 60).toISOString(), end: at("2026-11-10", 8 * 60).toISOString() }, { title: "Long run", start: at("2026-11-11", 7 * 60).toISOString(), end: at("2026-11-11", 9 * 60).toISOString() }] }, NOW) as any;
assert.ok(rc.ok); const [easyId, longId] = rc.sessions.map((x: any) => x.id) as string[];
const strava = (id: number, day: string, min: number, sport: string, movingS: number, distanceM: number) =>
  db().insert(events).values({ ts: at(day, min), domain: "activity", key: "activity.workout", valueText: sport, source: "strava", sourceId: `act:${id}`, payload: { id, name: `Morning ${sport}`, distanceM, movingS, avgHr: 151.6 } });
await strava(101, "2026-11-10", 7 * 60 + 5, "Run", 3000, 8000); await strava(102, "2026-11-11", 7 * 60, "Ride", 1500, 9000);
const SOON = at("2026-11-11", 12 * 60);
assert.equal(await al.autoLinkRecent(SOON), 1, "only the run matches the easy run; a ride does not match a long run");
let easy = (await g.sessionsOf(rg.id)).find((s) => s.id === easyId)!;
assert.equal(easy.actual?.id, 101); assert.equal(easy.status, "done", "50 of 60 planned minutes counts as done"); assert.equal(easy.minutes, 50);
assert.match(g.sessionJson(easy).actual!.summary, /^Actual: 5\.0 mi in 50:00, 10:04 \/mi, avg HR 152 \(Strava\)$/);
assert.match(JSON.parse(graph("PATCH").at(-1)!.body).body.content, /^Goal: Run goal\n\nActual: 5\.0 mi in 50:00, .*\(Strava\)\nhttps:\/\/www\.strava\.com\/activities\/101$/);
assert.equal(await al.autoLinkRecent(SOON), 0, "nothing new to pair the second time");
const longAct = await g.linkActivity(longId, 102) as any;
assert.ok(longAct.ok); assert.equal(longAct.completed, false, "25 of 120 minutes leaves the session planned"); assert.equal(longAct.session.status, "planned");
assert.equal(((await g.linkActivity(easyId, 102)) as any).ok, false, "an activity is linked to one session only");
assert.equal(((await g.linkActivity(easyId, 99999)) as any).ok, false); assert.equal(((await g.linkActivity("snope-1234", 101)) as any).ok, false);
assert.equal((await act(longId, { action: "link", activityId: null }, read.token)).status, 403);
assert.equal((await act(longId, { action: "link", activityId: null })).status, 200);
assert.doesNotMatch(JSON.parse(graph("PATCH").at(-1)!.body).body.content, /Actual/);
assert.equal((await g.sessionsOf(rg.id)).find((s) => s.id === longId)!.actual, null, "unlinked");
assert.equal((await act(longId, { action: "link", activityId: 102 })).status, 200); assert.equal((await act(longId, { action: "link", activityId: "x" })).status, 400);
// a calendar item that is one of the goal's sessions carries the session's status, note and run
const cs = await import("../lib/calendar-sessions.ts");
const easyNow = (await g.sessionsOf(rg.id)).find((s) => s.id === easyId)!;
const asItem = (id: number, sourceId?: string) => ({ id, title: "x", start: easyNow.start, end: easyNow.end, allDay: false, kind: "event" as const, sourceId });
const hits = await cs.sessionsForItems([asItem(1, easyNow.outlookEventId!), asItem(2, "other"), asItem(3)]);
assert.deepEqual([...hits.keys()], [1], "only the item whose event id belongs to a session is matched");
assert.equal(hits.get(1)!.goal, "Run goal"); assert.equal(hits.get(1)!.status, "done"); assert.equal(hits.get(1)!.actual?.url, "https://www.strava.com/activities/101");
assert.equal((await cs.sessionsForItems([asItem(3)])).size, 0);
// a skipped session comes back onto the calendar as an item of its own, struck through
const skipRange = [at("2026-11-11", 0), at("2026-11-12", 0), at("2026-11-12", 12 * 60)] as const; // from, to, and a "now" after the day
assert.equal((await cs.skippedItems(...skipRange)).items.length, 0, "nothing skipped yet");
const skippedLong = await g.skipSession(longId) as any; assert.ok(skippedLong.ok);
let sk = await cs.skippedItems(...skipRange);
assert.equal(sk.items.length, 1); assert.ok(sk.items[0]!.id < 0, "a made-up id that cannot clash with a stored event");
assert.deepEqual([sk.items[0]!.title, sk.sessions.get(sk.items[0]!.id)!.status, sk.sessions.get(sk.items[0]!.id)!.goal], ["Long run", "skipped", "Run goal"]);
assert.equal((await cs.skippedItems(at("2026-11-12", 0), at("2026-11-13", 0), skipRange[2])).items.length, 0, "only in its own days");
const ad = await import("../lib/app-data.ts");
const cr = await ad.calendarRange("2026-11-11", "2026-11-11", skipRange[2]) as any[];
assert.deepEqual(cr.filter((i) => i.session?.status === "skipped").map((i) => i.title), ["Long run"], "the app's calendar call includes it");
// a session that replaced it at the same time stands for it; two skipped at one time show once
const twin = await g.commitPlan(rg.id, { sessions: [{ title: "Long run v2", start: at("2026-11-11", 7 * 60).toISOString(), end: at("2026-11-11", 9 * 60).toISOString() }], allowOverlap: true }, NOW) as any;
assert.ok(twin.ok); assert.equal((await cs.skippedItems(...skipRange)).items.length, 0, "hidden while a replacement is planned");
await g.skipSession(twin.sessions[0].id);
assert.equal((await cs.skippedItems(...skipRange)).items.length, 1, "both skipped: one is shown");
assert.equal((await cs.skippedItems(skipRange[0], skipRange[1], at("2026-11-10", 12 * 60))).items.length, 0, "a skipped session in the future is not shown");
assert.equal((await cs.skippedItems(skipRange[0], skipRange[1], at("2026-11-11", 22 * 60))).items.length, 1, "it is shown on its own day");
await db().delete(events).where(sql`${events.payload}->>'goalId' = ${rg.id} or ${events.sourceId} = ${`goal:${rg.id}`} or ${events.source} = 'strava'`);

await wipe();
console.log("goals: ok");
process.exit(0);
