// One-off calendar events: add, clash rules, move, delete, and only touching what Life Stack added. Outlook is mocked. Run with `pnpm test`.
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
Object.assign(process.env, { MICROSOFT_CLIENT_ID: "cid", MICROSOFT_CLIENT_SECRET: "sec", ENCRYPTION_KEY: "ab".repeat(32), APP_URL: "https://app.example", APP_TZ: "America/New_York" });
const one = await import("../lib/oneoff.ts");
const { encrypt } = await import("../lib/crypto.ts");
const { db } = await import("../lib/db.ts");
const { events, connections, settings } = await import("@lifestack/db");

const NOW = new Date("2026-11-11T18:00:00Z"); // 1 PM in New York, a Wednesday
const calls: { method: string; url: string; body: string }[] = [];
let n = 0; let deleteStatus = 204;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url; const u = new URL(url); const method = init.method ?? "GET";
  calls.push({ method, url, body: String(init.body ?? "") });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  if (u.pathname.endsWith("/token")) return json({ access_token: "at", refresh_token: `rt-${++n}` });
  if (method === "POST" && u.pathname === "/v1.0/me/events") return json({ id: `evt-${++n}` }, 201);
  if (method === "PATCH") return json({ id: "x" });
  if (method === "DELETE") return deleteStatus === 204 ? new Response(null, { status: 204 }) : json({ error: "gone" }, deleteStatus);
  return json({ error: "unexpected" }, 500);
}) as typeof fetch;
const sent = (m: string) => calls.filter((c) => c.method === m && !c.url.includes("/token"));
const connect = () => db().insert(connections).values({ provider: "outlook", account: "me@example.com", refreshTokenEnc: encrypt("rt-start") });
const wipe = async () => { await db().delete(events); await db().delete(connections); await db().delete(settings); calls.length = 0; n = 0; deleteStatus = 204; };
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 11, h, m)); // UTC clock time on the 11th: 22:00Z is 5 PM New York
const meeting = (id: string, from: Date, to: Date) => db().insert(events).values({ ts: from, domain: "calendar", key: "calendar.event", payload: { title: "Meeting", end: to.toISOString(), allDay: false, kind: "event" }, source: "outlook", sourceId: id });

await wipe(); await connect();

// ---- adding
const a = await one.addEvent({ title: "  Call Mom  ", start: "2026-11-11T17:00", location: "Phone", note: "Ask about the trip" }, NOW) as any;
assert.ok(a.ok, a.error); assert.equal(a.calendar, "ok"); assert.equal(a.timeZone, "America/New_York");
assert.equal(a.event.title, "Call Mom"); assert.equal(a.event.start, "2026-11-11T22:00:00.000Z"); assert.equal(a.event.end, "2026-11-11T22:30:00.000Z", "30 minutes by default");
assert.match(a.event.id, /^e[0-9a-f]{8}$/); assert.equal(a.event.onCalendar, true);
const post = JSON.parse(sent("POST")[0]!.body);
assert.equal(post.subject, "Call Mom"); assert.deepEqual(post.categories, ["Life Stack"]); assert.equal(post.start.dateTime, "2026-11-11T22:00:00"); assert.equal(post.location.displayName, "Phone"); assert.equal(post.body.content, "Ask about the trip");
assert.equal(sent("POST").length, 1);
const evtA = ((await db().select().from(events)).find((e) => e.sourceId === `oneoff:${a.event.id}`)!.payload as any).outlookEventId as string; // the id Outlook gave it
assert.ok(evtA);

// ---- refusals
for (const bad of [{ title: "", start: "2026-11-11T19:00" }, { title: "x", start: "tonight" }, { title: "x", start: "2026-11-11T19:00", end: "2026-11-11T18:00" }, { title: "x", start: "2026-11-11T19:00", minutes: 900 }, {}, "nope"]) {
  assert.equal(((await one.addEvent(bad as any, NOW)) as any).ok, false, `refuses ${JSON.stringify(bad)}`);
}
assert.equal(sent("POST").length, 1, "nothing was sent to Outlook for those");

// ---- clashes: with the earlier event, a meeting and a planned session
const c1 = await one.addEvent({ title: "Overlaps the call", start: "2026-11-11T17:15" }, NOW) as any;
assert.equal(c1.ok, false); assert.equal(c1.conflicts.length, 1); assert.match(c1.error, /Nothing was added/); assert.match(c1.conflicts[0].with, /another event you added \("Call Mom"\)/, "an event added a moment ago already blocks, before Outlook has synced it");
await meeting("mtg-1", at(23), at(24));
const c2 = await one.addEvent({ title: "Over a meeting", start: "2026-11-11T18:15", minutes: 30 }, NOW) as any;
assert.equal(c2.ok, false, "a meeting blocks it"); assert.equal(c2.conflicts[0].with, "something already on your calendar");
await db().insert(events).values({ ts: at(15), domain: "goal", key: "goal.session", valueText: "planned", payload: { goalId: "g1", title: "Lower", end: at(16).toISOString(), day: "2026-11-11", movedFrom: [] }, source: "goals", sourceId: "session:s1" });
const c3 = await one.addEvent({ title: "Over a session", start: "2026-11-11T10:30" }, NOW) as any;
assert.equal(c3.ok, false); assert.match(c3.conflicts[0].with, /planned session \("Lower"\)/);
const forced = await one.addEvent({ title: "Anyway", start: "2026-11-11T18:15", allowOverlap: true }, NOW) as any;
assert.ok(forced.ok, "allowOverlap adds it anyway");
const back = await one.addEvent({ title: "Right after the call", start: "2026-11-11T17:30" }, NOW) as any;
assert.ok(back.ok, "back to back is not a clash");

// ---- moving: its own old slot never counts against it; a meeting still does
await db().insert(events).values({ ts: at(22), domain: "calendar", key: "calendar.event", payload: { title: "Call Mom", end: at(22, 30).toISOString(), allDay: false, kind: "event" }, source: "outlook", sourceId: evtA }); // the synced copy of the call
calls.length = 0;
const m1 = await one.moveEvent(a.event.id, { start: "2026-11-11T16:50" }, NOW) as any; // 10 minutes earlier: overlaps its own old slot
assert.ok(m1.ok, m1.error); assert.equal(m1.event.start, "2026-11-11T21:50:00.000Z"); assert.equal(m1.event.end, "2026-11-11T22:20:00.000Z", "its length is kept");
assert.deepEqual(m1.was, { start: "2026-11-11T22:00:00.000Z", end: "2026-11-11T22:30:00.000Z" });
assert.equal(sent("PATCH").length, 1); assert.deepEqual(Object.keys(JSON.parse(sent("PATCH")[0]!.body)), ["start", "end"], "the calendar event is moved, not rewritten");
assert.ok(sent("PATCH")[0]!.url.endsWith(`/me/events/${evtA}`));
const m2 = await one.moveEvent(a.event.id, { start: "2026-11-11T18:20" }, NOW) as any;
assert.equal(m2.ok, false, "onto a meeting is refused"); assert.match(m2.error, /Nothing was moved/);
assert.equal(((await one.moveEvent(a.event.id, { start: "2026-11-11T18:20", allowOverlap: true }, NOW)) as any).ok, true);
const m3 = await one.moveEvent(a.event.id, { start: "2026-11-11T20:00", minutes: 60 }, NOW) as any; assert.equal(m3.event.end, "2026-11-12T02:00:00.000Z", "an explicit length changes it");

// ---- only events Life Stack added can be moved or removed
assert.match(((await one.moveEvent("e00000000", { start: "2026-11-11T19:00" }, NOW)) as any).error, /No such one-off event/);
assert.match(((await one.moveEvent("s1", { start: "2026-11-11T19:00" }, NOW)) as any).error, /No such one-off event/, "a session id is not an event id");
assert.match(((await one.removeEvent(evtA)) as any).error, /No such one-off event/, "an Outlook id is not an event id either");
assert.equal(((await one.moveEvent(a.event.id, { start: "nonsense" }, NOW)) as any).ok, false);

// ---- finding them on the calendar
const map = await one.oneOffsForItems([{ id: 41, sourceId: evtA }, { id: 42, sourceId: "mtg-1" }, { id: 43 }] as any);
assert.deepEqual([...map.entries()], [[41, { id: a.event.id }]], "only the event added here is marked");

// ---- removing
calls.length = 0;
const d1 = await one.removeEvent(a.event.id) as any;
assert.ok(d1.ok); assert.equal(d1.removed.title, "Call Mom"); assert.equal(sent("DELETE").length, 1); assert.ok(sent("DELETE")[0]!.url.endsWith(`/me/events/${evtA}`));
assert.match(((await one.removeEvent(a.event.id)) as any).error, /No such one-off event/, "gone is gone");
deleteStatus = 404; assert.ok(((await one.removeEvent(forced.event.id)) as any).ok, "already gone from Outlook still counts as removed");
assert.equal((await one.oneOffsForItems([{ id: 1, sourceId: evtA }] as any)).size, 0);

// ---- Outlook not connected: nothing is saved
await db().delete(connections);
const nc = await one.addEvent({ title: "No calendar", start: "2026-11-12T10:00" }, NOW) as any;
assert.equal(nc.ok, false); assert.match(nc.error, /not connected/);
assert.equal((await db().select().from(events)).filter((e) => e.source === "oneoff" && (e.payload as any).title === "No calendar").length, 0, "no orphan record");

await wipe();
console.log("oneoff tests passed");
