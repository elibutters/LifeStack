// Workout maths: weeks, totals, records, streaks. Pure, no database.
import assert from "node:assert/strict";
const w = await import("../lib/workouts-core.ts"); const u = await import("../lib/units.ts");
const run = (date: string, km: number, min: number, extra: Partial<import("../lib/workouts-core.ts").Workout> = {}) => ({ id: Math.round(km * 1000), date, start: `${date}T12:00:00Z`, sport: "Run", name: `Run ${date}`, distanceM: km * 1000, movingS: min * 60, elapsedS: min * 60, elevationM: 10, avgHr: null, calories: null, effort: null, ...extra });

// weeks start on Monday
assert.equal(w.weekStart("2026-10-12"), "2026-10-12"); assert.equal(w.weekStart("2026-10-18"), "2026-10-12"); assert.equal(w.weekStart("2026-10-11"), "2026-10-05"); assert.equal(w.addDaysStr("2026-03-01", -1), "2026-02-28"); assert.equal(w.addDaysStr("2026-12-31", 1), "2027-01-01");

const today = "2026-10-14"; // a Wednesday
const ws = [run("2026-10-13", 10, 50), run("2026-10-11", 21, 96), run("2026-10-05", 6, 30), run("2026-09-23", 3.5, 17, { name: "short" }), run("2026-01-02", 5, 28), { ...run("2026-10-12", 20, 60), sport: "Ride" }, run("2026-10-10", 1.2, 8)];

// totals, with pace over runs only (the ride does not skew it)
const t = w.totalsOf(ws.filter((x) => x.date >= "2026-10-05" && x.date <= "2026-10-14"));
assert.equal(t.count, 5); assert.equal(t.distanceM, 10000 + 21000 + 6000 + 20000 + 1200); assert.equal(t.movingS, 3000 + 5760 + 1800 + 3600 + 480);
assert.equal(t.paceSecPerKm, Math.round((3000 + 5760 + 1800 + 480) / (38.2)), "pace counts runs only");
assert.deepEqual(w.totalsOf([]), { count: 0, distanceM: 0, movingS: 0, elevationM: 0, paceSecPerKm: null });
const win = w.windowTotals(ws, today);
assert.equal(win.last7.count, 4, "Oct 8 to 14: the 13th, 12th, 11th and 10th"); assert.equal(win.last28.count, 6); assert.equal(win.ytd.count, 7); assert.equal(win.all.count, 7);
assert.equal(w.windowTotals(ws, "2026-01-03").ytd.count, 1, "year to date starts on Jan 1");

// weekly buckets include empty weeks and end with the current week
const wk = w.weeklyBuckets(ws, today, 4);
assert.deepEqual(wk.map((x) => x.weekStart), ["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"]);
assert.deepEqual(wk.map((x) => x.count), [1, 0, 3, 2]); assert.equal(wk[1]!.distanceM, 0); assert.equal(wk.at(-1)!.distanceM, 10000 + 20000, "week of Oct 12: the 13th and the ride");
assert.equal(w.weeklyBuckets([], today, 3).length, 3); assert.equal(w.weeklyBuckets(ws, today, 1)[0]!.weekStart, "2026-10-12");

// heatmap: one cell per day, oldest first, ending today
const hm = w.heatmap(ws, today, 7); assert.equal(hm.length, 7); assert.equal(hm[0]!.date, "2026-10-08"); assert.equal(hm.at(-1)!.date, today);
assert.equal(hm.find((c) => c.date === "2026-10-13")!.distanceM, 10000); assert.equal(hm.find((c) => c.date === "2026-10-09")!.count, 0);

// pace series: runs of at least 2 miles (3.2 km), oldest first
const ps = w.paceSeries(ws); assert.equal(ps.length, 5, "the 1.2 km run and the ride are excluded; 3.5 km passes"); assert.equal(ps[0]!.date, "2026-01-02"); assert.equal(ps.at(-1)!.date, "2026-10-13"); assert.equal(ps.find((p) => p.date === "2026-10-13")!.paceSecPerKm, 300);

// records
const rec = w.records(ws);
assert.equal(rec.longest!.distanceM, 21000); assert.equal(rec.longest!.date, "2026-10-11"); assert.equal(rec.fastest!.date, "2026-10-11", "the 21 km run at 4:34/km is faster than the 10 km at 5:00/km"); 
assert.equal(rec.biggestWeek!.period, "2026-10-05", "Oct 5 to 11: 6 + 21 + 1.2 km of running, the ride is not a run"); assert.equal(rec.biggestMonth!.period, "2026-10"); assert.equal(w.records([]).longest, null);

// streaks
assert.equal(w.streakWeeks(ws, today), 2, "weeks of Oct 12 and Oct 5, then a gap"); assert.equal(w.streakWeeks(ws, "2026-10-19"), 2, "a week with no workout yet does not break the streak"); assert.equal(w.streakWeeks(ws, "2026-10-26"), 0); assert.equal(w.streakWeeks([], today), 0);

// sports and the combined overview
assert.deepEqual(w.sports(ws).map((s) => s.sport), ["Run", "Ride"]);
const ov = w.overviewOf(ws, today, 8, 3); assert.equal(ov.recent.length, 3); assert.equal(ov.recent[0]!.date, "2026-10-13", "newest first"); assert.equal(ov.weeks.length, 8); assert.equal(ov.heatmap.length, 84); assert.equal(ov.streakWeeks, 2);
assert.deepEqual(Object.keys(ov).sort(), ["heatmap", "pace", "recent", "records", "sports", "streakWeeks", "today", "totals", "weeks"]);

// US units
assert.equal(u.fmtMiles(1609.344), "1.0 mi"); assert.equal(u.fmtMiles(21151.2), "13.1 mi"); assert.equal(u.fmtDuration(5785), "1h 36m"); assert.equal(u.fmtDuration(95), "1:35"); assert.equal(u.fmtPace(273), "7:19 /mi"); assert.equal(u.fmtPace(null), "–"); assert.equal(u.fmtFeet(10), "33 ft");

console.log("WORKOUTS CORE OK");
