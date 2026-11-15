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
assert.deepEqual(await t.stopTimer("b", new Date(t0.getTime() + 240_000)), { stopped: true });
assert.deepEqual(await t.stopTimer("b"), { stopped: false }, "stopping twice is harmless");
assert.deepEqual(await t.stopTimer("nope"), { stopped: false });
st = await t.readTimers(new Date(t0.getTime() + 300_000));
assert.equal(st.running, null);
assert.deepEqual(st.recentlyStopped.map((x) => x.itemKey).sort(), ["a", "b"]);
st = await t.readTimers(new Date(t0.getTime() + 40 * 3_600_000));
assert.deepEqual(st.recentlyStopped, [], "a stop is forgotten after 36 hours");
const again2 = await t.startTimer({ itemKey: "a", title: "Easy run", style: "run", plan: [] }, new Date(t0.getTime() + 400_000));
assert.equal(again2.startedAt, new Date(t0.getTime() + 400_000).toISOString(), "a stopped item can be started again");

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
