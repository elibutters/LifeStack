// Deleting a goal for good, and every way it refuses. Outlook is mocked. Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
Object.assign(process.env, { MICROSOFT_CLIENT_ID: "cid", MICROSOFT_CLIENT_SECRET: "sec", ENCRYPTION_KEY: "ab".repeat(32), APP_URL: "https://app.example", APP_TZ: "America/New_York" });
const gd = await import("../lib/goal-delete.ts");
const g = await import("../lib/goals.ts");
const { encrypt } = await import("../lib/crypto.ts");
const { db } = await import("../lib/db.ts");
const { events, connections, settings } = await import("@lifestack/db");
const { sql } = await import("drizzle-orm");

const calls: { method: string; url: string }[] = [];
let deleteStatus = 204;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url; const u = new URL(url); const method = init.method ?? "GET";
  calls.push({ method, url });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  if (u.pathname.endsWith("/token")) return json({ access_token: "at", refresh_token: "rt-next" });
  if (method === "DELETE") return deleteStatus === 204 ? new Response(null, { status: 204 }) : json({ error: "x" }, deleteStatus);
  return json({ error: "unexpected" }, 500);
}) as typeof fetch;
const deletes = () => calls.filter((c) => c.method === "DELETE" && !c.url.includes("/token"));
const count = async () => (await db().select().from(events)).filter((e) => e.source === "goals").length;
const wipe = async () => { await db().delete(events); await db().delete(connections); await db().delete(settings); calls.length = 0; deleteStatus = 204; };
const session = (goalId: string, id: string, title: string, status: string, outlookEventId?: string) => db().insert(events).values({ ts: new Date("2026-11-11T22:00:00Z"), domain: "goal", key: "goal.session", valueText: status, payload: { goalId, title, end: "2026-11-11T22:30:00.000Z", day: "2026-11-11", movedFrom: [], ...(outlookEventId ? { outlookEventId } : {}) }, source: "goals", sourceId: `session:${id}` });
const goal = async (title: string, status?: string) => { const r = await g.createGoal({ title }) as any; assert.ok(r.ok); if (status) await g.updateGoal(r.goal.id, { status }); return r.goal.id as string; };

await wipe();
await db().insert(connections).values({ provider: "outlook", account: "me@example.com", refreshTokenEnc: encrypt("rt-start") });
const A = await goal("Calls & personal", "archived");
const B = await goal("Keep me", "active");
await session(A, "a1", "Call Mom (test)", "planned", "evt-A1"); await session(A, "a2", "Old idea", "replaced");
await session(B, "b1", "Real session", "planned", "evt-B1");
const before = await count(); assert.equal(before, 5);

// ---- refusals change nothing
const refused = async (id: string, input: any, re: RegExp) => { const r = await gd.deleteGoal(id, input) as any; assert.equal(r.ok, false); assert.match(r.error, re); assert.equal(await count(), before, "nothing deleted"); assert.equal(deletes().length, 0, "nothing sent to Outlook"); };
await refused("gnope", { confirmTitle: "x" }, /No such goal/);
await refused(B, { confirmTitle: "Keep me" }, /Archive it first/);
await refused(A, { confirmTitle: "calls & personal" }, /does not match.*exactly/);
await refused(A, { confirmTitle: "Calls" }, /does not match/);
await refused(A, {}, /confirmTitle is required/);
await refused(A, "nope", /confirmTitle is required/);

// ---- finished sessions are history
const H = await goal("Has history", "archived"); await session(H, "h1", "Done thing", "done", "evt-H1"); await session(H, "h2", "Planned thing", "planned", "evt-H2");
const withHistory = await count();
let r = await gd.deleteGoal(H, { confirmTitle: "Has history" }) as any;
assert.equal(r.ok, false); assert.match(r.error, /1 finished session.*history.*deleteHistory/); assert.equal(await count(), withHistory); assert.equal(deletes().length, 0);

// ---- a calendar failure stops everything before any record goes
deleteStatus = 500;
r = await gd.deleteGoal(A, { confirmTitle: "Calls & personal" }) as any;
assert.equal(r.ok, false); assert.match(r.error, /Could not remove "Call Mom \(test\)" from the calendar.*Nothing else was deleted/); assert.equal(await count(), withHistory, "the goal and its sessions are still there");
deleteStatus = 204;

// ---- the real deletion
calls.length = 0;
r = await gd.deleteGoal(A, { confirmTitle: "  Calls & personal " }) as any;
assert.ok(r.ok, r.error);
assert.deepEqual(r.deleted, { title: "Calls & personal", sessions: 2, finished: 0, calendarEvents: 1 }); assert.equal(r.notebook, null);
assert.equal(deletes().length, 1); assert.ok(deletes()[0]!.url.endsWith("/me/events/evt-A1"), "only its own event was removed");
const left = (await db().select().from(events)).filter((e) => e.source === "goals").map((e) => e.sourceId).sort();
assert.ok(!left.some((s) => s!.includes("a1") || s!.includes("a2") || s === `goal:${A}`), "the goal and both its sessions are gone");
assert.ok(left.includes(`goal:${B}`) && left.includes("session:b1"), "another goal and its session are untouched");
assert.ok(!deletes().some((c) => c.url.includes("evt-B1")), "the other goal's calendar event was never touched");
assert.match(((await gd.deleteGoal(A, { confirmTitle: "Calls & personal" })) as any).error, /No such goal/, "gone is gone");

// ---- deleting history on purpose, and a Notion page is never touched but its address is given
await db().update(events).set({ payload: sql`${events.payload} || '{"notionPageId":"1234abcd-0000-0000-0000-000000000000"}'::jsonb` }).where(sql`${events.sourceId} = ${`goal:${H}`}`);
calls.length = 0; deleteStatus = 404; // an event already gone from Outlook counts as removed
r = await gd.deleteGoal(H, { confirmTitle: "Has history", deleteHistory: true }) as any;
assert.ok(r.ok, r.error); assert.deepEqual(r.deleted, { title: "Has history", sessions: 2, finished: 1, calendarEvents: 2 }, "the finished session's event goes too");
assert.equal(r.notebook, "https://www.notion.so/1234abcd000000000000000000000000"); assert.ok(!calls.some((c) => c.url.includes("notion")), "Notion was not called");
assert.equal((await db().select().from(events)).filter((e) => e.source === "goals" && (e.sourceId === `goal:${H}` || String((e.payload as any).goalId) === H)).length, 0);

// ---- a draft can be deleted without archiving first
const D = await goal("Just a draft"); r = await gd.deleteGoal(D, { confirmTitle: "Just a draft" }) as any;
assert.ok(r.ok); assert.deepEqual(r.deleted, { title: "Just a draft", sessions: 0, finished: 0, calendarEvents: 0 });

await wipe();
console.log("goal-delete tests passed");
