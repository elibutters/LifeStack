// Session timer: validation, idempotent start, one running at a time, stop memory, and the bearer-protected API.
// Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) {
  console.error("refusing to run: not the test database");
  process.exit(2);
}
const core = await import("../lib/timer-core.ts");
const t = await import("../lib/timer.ts");
const tok = await import("../lib/tokens.ts");
const { db } = await import("../lib/db.ts");
const { events, apiTokens } = await import("@lifestack/db");
import { eq } from "drizzle-orm";

assert.equal(core.TimerInput.safeParse({ action: "start", itemKey: "s1", title: "Run" }).data?.style, "event");
assert.equal(core.TimerInput.safeParse({ action: "start", itemKey: "", title: "Run" }).success, false);
assert.equal(core.TimerInput.safeParse({ action: "nap", itemKey: "s1" }).success, false);

await db().delete(events).where(eq(events.source, "timer"));
const t0 = new Date("2026-11-14T20:00:00Z");
const a = await t.startTimer({ itemKey: "a", title: "Easy run", style: "run", plan: ["Main set:", "3 x 1 mile"] }, t0);
assert.equal(a.startedAt, t0.toISOString());
const again = await t.startTimer({ itemKey: "a", title: "Easy run", style: "run", plan: [] }, new Date(t0.getTime() + 60_000));
assert.equal(again.startedAt, t0.toISOString(), "a second start does not reset the clock");
assert.deepEqual(again.plan, ["Main set:", "3 x 1 mile"]);
await t.startTimer({ itemKey: "b", title: "Lift", style: "lift", plan: [] }, new Date(t0.getTime() + 120_000));
let st = await t.readTimers(new Date(t0.getTime() + 180_000));
assert.equal(st.running?.itemKey, "b", "starting another stops the first");
assert.deepEqual(st.recentlyStopped.map((x) => x.itemKey), ["a"]);
assert.deepEqual(await t.stopTimer("b", new Date(t0.getTime() + 240_000)), { stopped: true, minutes: 2 });
assert.deepEqual(await t.stopTimer("b"), { stopped: false }, "stopping twice is harmless");
assert.deepEqual(await t.stopTimer("nope"), { stopped: false });
st = await t.readTimers(new Date(t0.getTime() + 300_000));
assert.equal(st.running, null);
assert.deepEqual(st.recentlyStopped.map((x) => x.itemKey).sort(), ["a", "b"]);
st = await t.readTimers(new Date(t0.getTime() + 40 * 3_600_000));
assert.deepEqual(st.recentlyStopped, [], "a stop is forgotten after 36 hours");
const again2 = await t.startTimer({ itemKey: "a", title: "Easy run", style: "run", plan: [] }, new Date(t0.getTime() + 400_000));
assert.equal(again2.startedAt, new Date(t0.getTime() + 400_000).toISOString(), "a stopped item can be started again");

// ---- stopping a goal session's timer marks it done, for as long as it ran
assert.equal(core.minutesBetween("2026-11-14T20:00:00Z", "2026-11-14T20:44:40Z"), 45);
assert.equal(core.sessionIdOf("s:g1-abc"), "g1-abc"); assert.equal(core.sessionIdOf("ev:12"), null);
const tsNow = new Date(Date.now() - 3_600_000);
await db().insert(events).values({ ts: tsNow, domain: "goal", key: "goal.session", valueText: "planned", payload: { goalId: "gt", title: "Easy run", end: new Date(tsNow.getTime() + 1_800_000).toISOString() }, source: "goals", sourceId: "session:tsess-1" });
const began = new Date(Date.now() - 40 * 60_000);
await t.startTimer({ itemKey: "s:tsess-1", title: "Easy run", style: "run", plan: [] }, began);
const done = await t.stopTimer("s:tsess-1", new Date());
assert.equal(done.minutes, 40); assert.ok(done.logged, "the session was logged");
const row = (await db().select().from(events).where(eq(events.sourceId, "session:tsess-1")))[0]!;
assert.equal(row.valueText, "done"); assert.equal((row.payload as any).minutes, 40);
await db().insert(events).values({ ts: tsNow, domain: "goal", key: "goal.session", valueText: "planned", payload: { goalId: "gt", title: "Tap", end: new Date(tsNow.getTime() + 1_800_000).toISOString() }, source: "goals", sourceId: "session:tsess-2" });
const t1 = new Date(); await t.startTimer({ itemKey: "s:tsess-2", title: "Tap", style: "run", plan: [] }, new Date(t1.getTime() - 20_000));
const tap = await t.stopTimer("s:tsess-2", t1);
assert.equal(tap.logged, undefined, "under a minute is a mistaken tap");
assert.equal((await db().select().from(events).where(eq(events.sourceId, "session:tsess-2")))[0]!.valueText, "planned");

// ---- API
await db().delete(apiTokens);
const app = await tok.createToken("phone", "app", ["log:read", "log:write"]);
const readOnly = await tok.createToken("ro", "agent", ["log:read"]);
const call = (method: string, body?: unknown, token?: string) =>
  t.handleTimer(new Request("http://x/api/v1/timer", { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
assert.equal((await call("GET")).status, 401);
assert.equal((await call("POST", { action: "stop", itemKey: "a" }, readOnly.token)).status, 403);
assert.equal((await call("POST", { action: "start", itemKey: "" }, app.token)).status, 400);
const started = await (await call("POST", { action: "start", itemKey: "c", title: "Walk" }, app.token)).json() as any;
assert.equal(started.running.itemKey, "c");
assert.equal(((await (await call("GET", undefined, readOnly.token)).json()) as any).running.itemKey, "c", "a read key sees the same timer");
const ended = await (await call("POST", { action: "stop", itemKey: "c" }, app.token)).json() as any;
assert.equal(ended.running, null);
console.log("timer tests passed");
process.exit(0);
