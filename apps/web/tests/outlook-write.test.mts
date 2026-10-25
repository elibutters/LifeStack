// Outlook write: the event payload, idempotent creation, partial updates, safe deletes, and what happens before the owner has
// approved writing. Microsoft is mocked; nothing leaves the machine. Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
Object.assign(process.env, { MICROSOFT_CLIENT_ID: "cid", MICROSOFT_CLIENT_SECRET: "sec", ENCRYPTION_KEY: "ab".repeat(32), APP_URL: "https://app.example", APP_TZ: "UTC" });
const ow = await import("../lib/outlook-write.ts");
const ms = await import("../lib/microsoft.ts");
const { encrypt, decrypt } = await import("../lib/crypto.ts");
const { db } = await import("../lib/db.ts");
const { connections } = await import("@lifestack/db");

type Call = { method: string; url: string; body: string; headers: Headers };
const calls: Call[] = [];
let tokenMode: "ok" | "consent" = "ok"; let rotation = 0; let graphStatus: Record<string, number> = {};
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url; const u = new URL(url);
  const method = init.method ?? "GET"; const headers = new Headers(init.headers ?? {}); const body = String(init.body ?? "");
  calls.push({ method, url, body, headers });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  if (u.pathname.endsWith("/token")) {
    if (tokenMode === "consent") return json({ error: "consent_required" }, 400);
    rotation++; return json({ access_token: `at-${rotation}`, refresh_token: `rt-${rotation}` });
  }
  const forced = graphStatus[method];
  if (forced) return new Response(forced === 204 ? null : JSON.stringify({ error: "x" }), { status: forced });
  if (method === "POST" && u.pathname === "/v1.0/me/events") return json({ id: `evt-${JSON.parse(body).subject}` }, 201);
  if (method === "PATCH") return json({ id: "x" });
  if (method === "DELETE") return new Response(null, { status: 204 });
  return json({ error: "unexpected" }, 500);
}) as typeof fetch;
const reset = async () => { await db().delete(connections); calls.length = 0; tokenMode = "ok"; rotation = 0; graphStatus = {}; };
const connect = () => db().insert(connections).values({ provider: "outlook", account: "me@example.com", refreshTokenEnc: encrypt("rt-start") });
const graphCalls = () => calls.filter((c) => !c.url.includes("/token"));
const tokenCalls = () => calls.filter((c) => c.url.includes("/token"));

// ---- the payload
const s1 = { key: "goal1:2026-10-27", title: "Interview prep", start: new Date("2026-10-27T23:00:00Z"), end: new Date("2026-10-28T00:00:00Z"), body: "Review topics 1 to 3" };
const p = ow.eventPayload(s1);
assert.deepEqual(p.start, { dateTime: "2026-10-27T23:00:00", timeZone: "UTC" }); assert.deepEqual(p.end, { dateTime: "2026-10-28T00:00:00", timeZone: "UTC" });
assert.deepEqual([p.subject, p.categories, p.showAs, p.isReminderOn, p.reminderMinutesBeforeStart], ["Interview prep", ["Life Stack"], "busy", true, 15]);
assert.equal(p.body.content, "Review topics 1 to 3");
assert.match(p.transactionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/, "a GUID Graph accepts");
assert.equal(ow.transactionId("a"), ow.transactionId("a")); assert.notEqual(ow.transactionId("a"), ow.transactionId("b"));
assert.equal(ow.eventPayload({ ...s1, title: "x".repeat(500), body: "y".repeat(9000) }).subject.length, 200); assert.equal(ow.eventPayload({ ...s1, body: "y".repeat(9000) }).body.content.length, 4000);
assert.equal(ow.eventPayload({ ...s1, reminderMin: 5 }).reminderMinutesBeforeStart, 5);
assert.deepEqual(ow.eventPatch({ start: s1.start, end: s1.end }), { start: p.start, end: p.end }, "a move touches only the times");
assert.deepEqual(ow.eventPatch({ title: "New" }), { subject: "New" }); assert.deepEqual(ow.eventPatch({}), {});

// ---- the permission
assert.match(ms.WRITE_SCOPES, /Calendars\.ReadWrite/); assert.ok(!/Calendars\.ReadWrite/.test(ms.CALENDAR_SCOPES) && !/Calendars\.ReadWrite/.test(ms.MAIL_SCOPES), "syncing never asks for write");
assert.match(new URL(ms.authorizeUrl("https://app.example", "st", "ch")).searchParams.get("scope")!, /Calendars\.ReadWrite/, "connecting asks for write");

// ---- not connected, and not yet approved
await reset();
assert.deepEqual(await ow.createEvents([s1]), { ok: false, reason: "not_connected" }); assert.equal(calls.length, 0);
await connect(); tokenMode = "consent";
assert.deepEqual(await ow.createEvents([s1]), { ok: false, reason: "needs_reconnect" }, "before the owner approves writing, it asks to reconnect");
assert.equal(graphCalls().length, 0, "and nothing is sent to the calendar");
assert.match(ow.NEEDS_WRITE, /Reconnect Outlook/);

// ---- creating
await reset(); await connect();
let r = await ow.createEvents([s1, { ...s1, key: "goal1:2026-10-29", title: "Second", start: new Date("2026-10-29T23:00:00Z"), end: new Date("2026-10-30T00:00:00Z") }]);
assert.deepEqual(r, { ok: true, value: [{ key: "goal1:2026-10-27", id: "evt-Interview prep" }, { key: "goal1:2026-10-29", id: "evt-Second" }] }, "each session key maps to its Outlook id");
assert.equal(tokenCalls().length, 1, "one token for the whole batch");
assert.match(new URLSearchParams(tokenCalls()[0]!.body).get("scope")!, /Calendars\.ReadWrite/, "the token request asks for write");
const post = graphCalls()[0]!; assert.deepEqual([post.method, new URL(post.url).origin + new URL(post.url).pathname], ["POST", "https://graph.microsoft.com/v1.0/me/events"]);
assert.equal(post.headers.get("authorization"), "Bearer at-1"); assert.match(post.headers.get("prefer")!, /ImmutableId/, "ids match what the calendar sync stores");
assert.equal(JSON.parse(post.body).transactionId, ow.transactionId("goal1:2026-10-27"), "created idempotently");
assert.equal(decrypt((await db().select().from(connections))[0]!.refreshTokenEnc), "rt-1", "the rotated refresh token is stored encrypted");
// a failure part-way is reported
await reset(); await connect(); graphStatus = { POST: 500 };
assert.deepEqual(await ow.createEvents([s1]), { ok: false, reason: "failed" });
await reset(); await connect(); graphStatus = { POST: 403 };
assert.deepEqual(await ow.createEvents([s1]), { ok: false, reason: "needs_reconnect" }, "a refused write means writing was not approved");
// the connection changing under it abandons the write
await reset(); await connect();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any) => { const res = await realFetch(input, init); if (String(typeof input === "string" ? input : input.url).endsWith("/token")) await db().update(connections).set({ refreshTokenEnc: encrypt("someone-else") }); return res; }) as typeof fetch;
assert.deepEqual(await ow.createEvents([s1]), { ok: false, reason: "not_connected" }); assert.equal(graphCalls().length, 0, "nothing written after losing the swap");
globalThis.fetch = realFetch;

// ---- updating and deleting
await reset(); await connect();
assert.deepEqual(await ow.updateEvent("evt/with slash", { start: s1.start, end: s1.end }), { ok: true, value: true });
const patch = graphCalls()[0]!; assert.equal(patch.method, "PATCH"); assert.ok(patch.url.endsWith("/me/events/evt%2Fwith%20slash"), "the id is escaped"); assert.deepEqual(Object.keys(JSON.parse(patch.body)), ["start", "end"]);
await reset(); await connect();
assert.deepEqual(await ow.deleteEvent("evt-1"), { ok: true, value: true }); assert.equal(graphCalls()[0]!.method, "DELETE");
await reset(); await connect(); graphStatus = { DELETE: 404 };
assert.deepEqual(await ow.deleteEvent("gone"), { ok: true, value: true }, "deleting something already gone is a success");
await reset(); await connect(); graphStatus = { DELETE: 500 };
assert.deepEqual(await ow.deleteEvent("evt-1"), { ok: false, reason: "failed" });

// ---- the Graph sender only talks to Graph
await assert.rejects(() => ms.graphSend("POST", "https://evil.example/v1.0/me/events", "tok", {}), /refusing non-Graph URL/);

await reset();
console.log("outlook-write: ok");
process.exit(0);
