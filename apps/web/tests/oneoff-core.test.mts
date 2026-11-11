// The time and clash rules for one-off calendar events. Pure; run with `pnpm test`.
import assert from "node:assert/strict";
import { clashes, resolveWindow } from "../lib/oneoff-core.ts";

const NY = "America/New_York";
const NOW = new Date("2026-11-11T18:00:00Z"); // 1 PM New York
const ok = (r: any) => { assert.ok(r.ok, r.error); return r.window as { start: Date; end: Date }; };

// a local time with no offset is the owner's own; a length defaults to 30 minutes
let w = ok(resolveWindow({ start: "2026-11-11T17:00" }, NY, NOW));
assert.equal(w.start.toISOString(), "2026-11-11T22:00:00.000Z"); assert.equal(w.end.toISOString(), "2026-11-11T22:30:00.000Z");
w = ok(resolveWindow({ start: "2026-11-11T17:00", minutes: 90 }, NY, NOW)); assert.equal(w.end.toISOString(), "2026-11-11T23:30:00.000Z");
w = ok(resolveWindow({ start: "2026-11-11T17:00:00-05:00", end: "2026-11-11T18:15" }, NY, NOW)); assert.equal(w.end.toISOString(), "2026-11-11T23:15:00.000Z", "an explicit end can be a local time too");

// refusals say why
const why = (i: any) => (resolveWindow(i, NY, NOW) as any).error as string;
assert.match(why({ start: "tonight" }), /start is not a valid time/);
assert.match(why({ start: "2026-11-11T17:00", end: "soon" }), /end is not a valid time/);
assert.match(why({ start: "2026-11-11T17:00", end: "2026-11-11T16:00" }), /ends before it starts/);
assert.match(why({ start: "2026-11-11T17:00", minutes: 0 }), /at least 1/);
assert.match(why({ start: "2026-11-11T08:00", end: "2026-11-11T21:00" }), /at most 12 hours/);
assert.match(why({ start: "2026-09-01T10:00" }), /30 days in the past/);
assert.match(why({ start: "2028-01-01T10:00" }), /more than a year away/);
ok(resolveWindow({ start: "2026-11-10T09:00" }, NY, NOW)); // yesterday is fine: recording something that happened

// clashes: any overlap counts, touching edges do not
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 11, h, m));
const win = { start: at(22), end: at(22, 30) };
assert.deepEqual(clashes(win, [{ start: at(21), end: at(22), what: "a" }, { start: at(22, 30), end: at(23), what: "b" }]), [], "back to back is fine");
const hits = clashes(win, [{ start: at(21, 45), end: at(22, 15), what: "a meeting" }, { start: at(22, 29), end: at(23), what: "a planned session" }, { start: at(10), end: at(11), what: "elsewhere" }]);
assert.deepEqual(hits.map((h) => h.with), ["a meeting", "a planned session"]);
console.log("oneoff-core tests passed");
