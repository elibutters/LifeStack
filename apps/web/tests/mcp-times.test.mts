// Local times next to UTC ones in tool answers. Pure; run with `pnpm test`.
import assert from "node:assert/strict";
import { addLocalTimes, localIso } from "../lib/mcp-times.ts";

const NY = "America/New_York";
assert.equal(localIso(new Date("2026-11-11T15:05:30Z"), NY), "2026-11-11T10:05:30-05:00", "winter offset");
assert.equal(localIso(new Date("2026-07-04T16:00:00Z"), NY), "2026-07-04T12:00:00-04:00", "summer offset");
assert.equal(localIso(new Date("2026-11-01T05:59:59Z"), NY), "2026-11-01T01:59:59-04:00", "just before the clocks go back");
assert.equal(localIso(new Date("2026-11-01T06:00:00Z"), NY), "2026-11-01T01:00:00-05:00", "the repeated hour has the other offset");
assert.equal(localIso(new Date("2026-03-08T07:00:00Z"), NY), "2026-03-08T03:00:00-04:00", "the skipped hour");
assert.equal(localIso(new Date("2026-11-11T15:05:30Z"), "Asia/Kolkata"), "2026-11-11T20:35:30+05:30", "a half-hour zone");
assert.equal(localIso(new Date("2026-11-11T15:05:30Z"), "UTC"), "2026-11-11T15:05:30+00:00");
assert.equal(new Date(localIso(new Date("2026-11-11T15:05:30Z"), NY)).toISOString(), "2026-11-11T15:05:30.000Z", "round-trips to the same instant");

// an activity as Strava gives it: startLocal is wall-clock time with a misleading Z
const act = addLocalTimes({ activities: [{ id: 1, start: "2026-11-11T15:05:30.000Z", startLocal: "2026-11-11T10:05:30Z", name: "Intervals" }] }, NY) as any;
assert.equal(act.activities[0].startLocal, "2026-11-11T10:05:30-05:00", "startLocal is the real local time, with its offset");
assert.equal(act.activities[0].start, "2026-11-11T15:05:30.000Z", "the UTC instant is kept");

// events, sessions, nested objects, dates that are not timestamps
const out = addLocalTimes([
  { title: "Run", start: "2026-11-11T23:30:00.000Z", end: "2026-11-12T00:10:00.000Z", allDay: false },
  { title: "Holiday", start: "2026-11-11", end: "2026-11-12", allDay: true },
  { session: { start: "2026-11-11T17:00:00.000Z", doneAt: "2026-11-11T18:00:00.000Z" }, suggestion: null, count: 3, note: "2026-11-11T17:00:00.000Z" },
  { caffeine: { lastAt: "2026-11-11T13:00:00Z" } },
], NY) as any[];
assert.deepEqual([out[0].startLocal, out[0].endLocal], ["2026-11-11T18:30:00-05:00", "2026-11-11T19:10:00-05:00"]);
assert.ok(!("startLocal" in out[1]), "all-day dates are left alone");
assert.deepEqual([out[2].session.startLocal, out[2].session.doneAtLocal], ["2026-11-11T12:00:00-05:00", "2026-11-11T13:00:00-05:00"], "nested too");
assert.ok(!("noteLocal" in out[2]), "only the known time keys");
assert.equal(out[3].caffeine.lastAtLocal, "2026-11-11T08:00:00-05:00");
assert.equal(addLocalTimes("text", NY), "text"); assert.equal(addLocalTimes(null, NY), null); assert.equal(addLocalTimes(5, NY), 5);
const input = { start: "2026-11-11T17:00:00.000Z" }; addLocalTimes(input, NY); assert.deepEqual(input, { start: "2026-11-11T17:00:00.000Z" }, "the input is not changed");
console.log("mcp-times tests passed");
