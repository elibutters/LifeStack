// Sync health rules: pure, no database.
import assert from "node:assert/strict";
const h = await import("../lib/sync-health-core.ts");

const now = new Date("2026-11-15T12:00:00Z");
const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000);
const s = (key: string, hoursAgo: number | null, lastError: string | null = null) => ({ key, label: key, lastOkAt: hoursAgo === null ? null : at(hoursAgo), lastError });

assert.equal(h.checkSource(s("strava", 5), now).health, "ok");
assert.equal(h.checkSource(s("strava", 29.9), now).health, "ok", "just inside a day and a bit");
assert.equal(h.checkSource(s("strava", 31), now).health, "stale");
assert.equal(h.checkSource(s("strava", 31, "Token expired"), now).health, "failing");
assert.equal(h.checkSource(s("strava", 3, "Sync failed. It will retry."), now).health, "warning", "an error with fresh data is only a warning");
assert.equal(h.checkSource(s("strava", null), now).health, "never");
assert.match(h.checkSource(s("strava", 80), now).message!, /3 days/);
assert.match(h.checkSource(s("strava", 31), now).message!, /31 hours/);
assert.equal(h.checkSource(s("strava", 31), now).ageHours, 31);

const all = h.checkAll([s("a", 2), s("b", 50), s("c", 40, "boom"), s("d", null), s("e", 1, "meh")], now);
assert.deepEqual(all.sources.map((x) => x.key), ["c", "b", "d", "e", "a"], "worst first");
assert.equal(all.problems, 3, "warnings are not counted as problems");
assert.deepEqual(h.checkAll([], now), { sources: [], problems: 0 });
console.log("sync-health tests passed");
