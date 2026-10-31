// Goals engine: local time, free time, turning a goal into sessions, placing them, and moving one that slipped. Pure, no database.
import assert from "node:assert/strict";
const g = await import("../lib/goals-core.ts");

const NY = { ...g.DEFAULT_CONSTRAINTS, tz: "America/New_York" };
const at = (day: string, min: number, c = NY) => g.localToDate(day, min, c.tz);
const hm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
const day = (d: Date) => g.localDay(d, "America/New_York");

// ---- local time, including daylight saving
assert.equal(at("2026-10-31", 19 * 60).toISOString(), "2026-10-31T23:00:00.000Z", "EDT is UTC-4");
assert.equal(at("2026-11-02", 19 * 60).toISOString(), "2026-11-03T00:00:00.000Z", "EST is UTC-5");
assert.equal(g.localDay(new Date("2026-11-03T03:30:00Z"), "America/New_York"), "2026-11-02");
assert.equal((at("2026-11-02", 0).getTime() - at("2026-11-01", 0).getTime()) / 3_600_000, 25, "the day daylight saving ends has 25 hours");
assert.equal((at("2026-03-09", 0).getTime() - at("2026-03-08", 0).getTime()) / 3_600_000, 23, "and the day it starts has 23");
assert.equal(g.addDay("2026-10-31", 1), "2026-11-01"); assert.equal(g.addDay("2026-12-31", 1), "2027-01-01"); assert.equal(g.addDay("2026-03-01", -1), "2026-02-28");
assert.deepEqual(["2026-10-26", "2026-10-31", "2026-11-01"].map(g.weekdayOf), [0, 5, 6], "Monday is 0");
assert.equal(g.daysBetween("2026-10-26", "2026-11-09"), 14);

// ---- free time
const mon = "2026-10-26", sat = "2026-10-31";
const early = at(mon, 8 * 60);
let free = g.freeSlots(at(mon, 0), at(mon, 23 * 60 + 59), [], NY, early);
assert.deepEqual(free.map((i) => [hm(i.start), hm(i.end)]), [["18:00", "22:30"]], "a weekday has the evening window");
free = g.freeSlots(at(mon, 0), at(mon, 23 * 60 + 59), [{ start: at(mon, 19 * 60), end: at(mon, 20 * 60) }], NY, early);
assert.deepEqual(free.map((i) => [hm(i.start), hm(i.end)]), [["18:00", "18:45"], ["20:15", "22:30"]], "a meeting blocks its time plus the buffer");
free = g.freeSlots(at(mon, 0), at(mon, 23 * 60 + 59), [{ start: at(mon, 19 * 60), end: at(mon, 20 * 60) }], NY, at(mon, 20 * 60));
assert.deepEqual(free.map((i) => [hm(i.start), hm(i.end)]), [["20:15", "22:30"]], "nothing in the past is free");
free = g.freeSlots(at(sat, 0), at(sat, 23 * 60 + 59), [], NY, early);
assert.deepEqual(free.map((i) => [hm(i.start), hm(i.end)]), [["09:00", "21:00"]], "weekends use the weekend hours");
free = g.freeSlots(at(mon, 0), at(mon, 23 * 60 + 59), [], { ...NY, latestEndMin: 21 * 60 }, early);
assert.deepEqual(free.map((i) => [hm(i.start), hm(i.end)]), [["18:00", "21:00"]], "the latest end caps the window");
assert.equal(g.freeSlots(at(mon, 0), at(mon, 23 * 60 + 59), [{ start: at(mon, 17 * 60), end: at(mon, 23 * 60) }], NY, early).length, 0, "a busy evening leaves nothing");
assert.equal(g.freeSlots(at(mon, 0), at(mon, 23 * 60 + 59), [{ start: at(mon, 18 * 60 + 40), end: at(mon, 22 * 60 + 30) }], NY, early, 30).length, 0, "pieces shorter than the minimum are dropped");

// ---- turning a goal into wanted sessions
const prep = g.cadence({ fromDay: mon, targetDay: "2026-11-09", everyDays: 2, durationMin: 60, title: "Interview prep", taperLast: 2 });
assert.deepEqual(prep.map((d) => d.day), ["2026-10-27", "2026-10-29", "2026-10-31", "2026-11-02", "2026-11-04", "2026-11-06", "2026-11-08"], "every other day, counting back from the day before");
assert.deepEqual(prep.map((d) => d.durationMin), [60, 60, 60, 60, 60, 30, 30], "the last two are light");
assert.ok(prep.at(-1)!.title.endsWith("(light)") && !prep[0]!.title.includes("light"));
assert.equal(g.cadence({ fromDay: "2026-11-08", targetDay: "2026-11-09", everyDays: 2, durationMin: 60, title: "x" }).length, 1, "a short runway still gets a session");
assert.equal(g.cadence({ fromDay: "2026-11-09", targetDay: "2026-11-09", everyDays: 2, durationMin: 60, title: "x" }).length, 0, "no days before the target means none");
const dly = g.daily({ fromDay: mon, toDay: "2026-11-01", durationMin: 45, title: "YC", weekdays: [0, 1, 2, 3, 4] });
assert.deepEqual(dly.map((d) => d.day), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"], "weekday sessions only");
assert.equal(g.daily({ fromDay: mon, toDay: "2026-11-01", durationMin: 45, title: "YC" }).length, 7);
const m12 = g.trainingMultipliers(12);
assert.equal(m12.length, 12); assert.deepEqual(m12.slice(-2), [0.7, 0.5], "a two week taper");
assert.ok(m12[3]! < m12[2]! && m12[7]! < m12[6]!, "every fourth week steps back"); assert.ok(Math.max(...m12) <= 1.16 && m12[0]! >= 0.79);
assert.deepEqual(g.trainingMultipliers(1), [1.15]);
const wk = g.weeklyPlan({ fromDay: mon, toDay: "2026-11-08", template: [{ weekday: 1, durationMin: 60, title: "Easy" }, { weekday: 5, durationMin: 90, title: "Long" }], multipliers: [1, 0.5] });
assert.deepEqual(wk.map((d) => [d.day, d.durationMin]), [["2026-10-27", 60], ["2026-10-31", 90], ["2026-11-03", 30], ["2026-11-07", 45]], "the template repeats, scaled per week");
assert.deepEqual(g.weeklyPlan({ fromDay: "2026-10-28", toDay: "2026-11-01", template: [{ weekday: 1, durationMin: 60, title: "x" }, { weekday: 5, durationMin: 60, title: "y" }] }).map((d) => d.day), ["2026-10-31"], "days before the start are skipped");

// ---- placing sessions
const range = (c = NY) => g.freeSlots(at(mon, 0), at("2026-11-10", 0), [], c, early);
let r = g.place(prep, range(), NY);
assert.equal(r.unplaced.length, 0); assert.equal(r.placed.length, 7);
assert.deepEqual(r.placed.map((p) => [day(p.start), hm(p.start), p.shiftedDays]), [["2026-10-27", "19:00", 0], ["2026-10-29", "19:00", 0], ["2026-10-31", "19:00", 0], ["2026-11-02", "19:00", 0], ["2026-11-04", "19:00", 0], ["2026-11-06", "19:00", 0], ["2026-11-08", "19:00", 0]], "an open calendar gets the preferred start every time");
assert.deepEqual(r.placed.map((p) => (p.end.getTime() - p.start.getTime()) / 60000), [60, 60, 60, 60, 60, 30, 30]);
// a busy evening pushes the session to the next day, and that is reported
const busyThu = [{ start: at("2026-10-29", 17 * 60), end: at("2026-10-29", 23 * 60) }];
r = g.place(prep, g.freeSlots(at(mon, 0), at("2026-11-10", 0), busyThu, NY, early), NY);
const moved = r.placed.find((p) => p.day === "2026-10-29")!;
assert.deepEqual([moved.placedDay, moved.shiftedDays], ["2026-10-30", 1], "it moves to the nearest day with room");
// no flex: it is reported, not dropped silently
r = g.place(prep.map((d) => ({ ...d, flexDays: 0 })), g.freeSlots(at(mon, 0), at("2026-11-10", 0), busyThu, NY, early), NY);
assert.equal(r.placed.length, 6); assert.equal(r.unplaced.length, 1); assert.match(r.unplaced[0]!.reason, /no 60 minute gap within 0 days of 2026-10-29/);
// sessions already on the calendar block time and count toward the daily limit
const have = { start: at("2026-10-27", 19 * 60), end: at("2026-10-27", 20 * 60) };
r = g.place([{ title: "x", day: "2026-10-27", durationMin: 60 }], range(), NY, [have]);
assert.deepEqual([hm(r.placed[0]!.start), r.placed[0]!.placedDay], ["20:15", "2026-10-27"], "it fits around an existing session, with the buffer");
const two = [have, { start: at("2026-10-27", 21 * 60), end: at("2026-10-27", 21 * 60 + 30) }];
r = g.place([{ title: "x", day: "2026-10-27", durationMin: 30 }], range(), NY, two);
assert.equal(r.placed[0]!.placedDay, "2026-10-28", "two sessions that day is the limit");
r = g.place([{ title: "x", day: "2026-10-27", durationMin: 60, flexDays: 3, earliestDay: "2026-10-27", latestDay: "2026-10-27" }], range(), NY, two);
assert.equal(r.unplaced.length, 1, "the earliest and latest days are respected");
// several sessions on one day do not overlap and respect the limit
r = g.place([1, 2, 3].map((n) => ({ title: `s${n}`, day: "2026-10-27", durationMin: 60, flexDays: 0 })), range(), NY);
assert.equal(r.placed.length, 2); assert.equal(r.unplaced.length, 1);
assert.ok(r.placed[0]!.end.getTime() + 15 * 60000 <= r.placed[1]!.start.getTime(), "a buffer between them");
// a long session needs a long gap
assert.equal(g.place([{ title: "x", day: "2026-10-27", durationMin: 300, flexDays: 0 }], range(), NY).unplaced.length, 1, "five hours does not fit a 4.5 hour evening");
assert.equal(g.place([{ title: "x", day: sat, durationMin: 300, flexDays: 0 }], range(), NY).placed.length, 1, "but fits a weekend");
// daylight saving: 19:00 local stays 19:00 local
const across = g.place([{ title: "x", day: "2026-10-31", durationMin: 60, flexDays: 0 }, { title: "y", day: "2026-11-02", durationMin: 60, flexDays: 0 }], range(), NY);
assert.deepEqual(across.placed.map((p) => hm(p.start)), ["19:00", "19:00"]);

// ---- is it realistic, and what slipped
const fe = g.feasibility([{ title: "a", day: mon, durationMin: 60 }, { title: "b", day: mon, durationMin: 60 }, { title: "c", day: mon, durationMin: 60 }], [{ start: at(mon, 18 * 60), end: at(mon, 19 * 60 + 30) }]);
assert.deepEqual(fe, { neededMin: 180, availableMin: 90, shortMin: 90 });
assert.equal(g.feasibility([], []).shortMin, 0);
const now = at(mon, 21 * 60);
assert.equal(g.statusAt({ status: "planned", end: at(mon, 19 * 60) }, now), "missed", "an hour past its end with no Done");
assert.equal(g.statusAt({ status: "planned", end: at(mon, 20 * 60 + 30) }, now), "planned", "still within the grace period");
assert.equal(g.statusAt({ status: "done", end: at(mon, 8 * 60) }, now), "done"); assert.equal(g.statusAt({ status: "skipped", end: at(mon, 8 * 60) }, now), "skipped");
// moving a missed session
const t0 = at(mon, 18 * 60);
const freeNow = g.freeSlots(t0, at("2026-11-10", 0), [], NY, t0);
let rs = g.reschedule({ durationMin: 60, free: freeNow, c: NY, existing: [], now: t0 });
assert.deepEqual([day(rs!.start), hm(rs!.start)], [mon, "19:00"], "later today if there is room");
rs = g.reschedule({ durationMin: 60, free: g.freeSlots(at(mon, 21 * 60 + 50), at("2026-11-10", 0), [], NY, at(mon, 21 * 60 + 50)), c: NY, existing: [], now: at(mon, 21 * 60 + 50) });
assert.deepEqual([day(rs!.start), hm(rs!.start)], ["2026-10-27", "19:00"], "otherwise tomorrow");
rs = g.reschedule({ durationMin: 60, free: freeNow, c: NY, existing: [{ start: at(mon, 19 * 60), end: at(mon, 20 * 60) }, { start: at(mon, 21 * 60), end: at(mon, 21 * 60 + 30) }], now: t0 });
assert.equal(day(rs!.start), "2026-10-27", "a full day is skipped");
assert.equal(g.reschedule({ durationMin: 60, free: g.freeSlots(at(mon, 21 * 60 + 50), at("2026-11-10", 0), [], NY, at(mon, 21 * 60 + 50)), c: NY, existing: [], now: at(mon, 21 * 60 + 50), lastDay: mon }), null, "past the goal's last day there is nowhere to go, so it should ask");
assert.equal(g.reschedule({ durationMin: 780, free: freeNow, c: NY, existing: [], now: t0 }), null, "nothing long enough in two weeks");
// the lead time keeps a moved session from starting right now
rs = g.reschedule({ durationMin: 60, free: g.freeSlots(at(mon, 18 * 60 + 45), at("2026-11-10", 0), [], NY, at(mon, 18 * 60 + 45)), c: NY, existing: [], now: at(mon, 18 * 60 + 45) });
assert.ok(rs!.start.getTime() >= at(mon, 18 * 60 + 45).getTime() + 30 * 60000);

// a session can ask to start somewhere other than the general preference
r = g.place([{ title: "Long", day: sat, durationMin: 90, flexDays: 0, startMin: 9 * 60 }, { title: "Easy", day: sat, durationMin: 30, flexDays: 0 }], range(), NY);
assert.equal(hm(r.placed.find((p) => p.title === "Long")!.start), "09:00", "its own start time wins");
assert.equal(hm(r.placed.find((p) => p.title === "Easy")!.start), "19:00", "others keep the general preference");
assert.equal(g.weeklyPlan({ fromDay: mon, toDay: "2026-11-02", template: [{ weekday: 5, durationMin: 60, title: "Long", startMin: 540 }] })[0].startMin, 540, "the template passes it on");

console.log("goals-core: ok");

// ---- Strava link rules
{
  const sl = await import("../lib/strava-link-core.ts");
  const mk = (id: string, title: string, day: string, from: number, to: number, extra = {}) => ({ id, title, start: at(day, from), end: at(day, to), durationMin: to - from, status: "planned", actual: null, ...extra });
  const act = (id: number, day: string, min: number, sport = "Run", movingS = 3000) => ({ id, name: null, sport, distanceM: 8000, movingS, avgHr: null, start: at(day, min).toISOString() });
  assert.deepEqual(sl.sportsFor("Easy 3 mi + strides"), ["Run", "TrailRun", "VirtualRun"]); assert.equal(sl.sportsFor("Interview prep"), null);
  assert.ok(sl.sportFits("Interview prep", "Run"), "a title without a sport matches any sport"); assert.equal(sl.sportFits("Long run", "Ride"), false); assert.ok(sl.sportFits("Bike ride", "GravelRide"));
  const run = mk("a", "Easy run", "2026-11-10", 420, 480);
  assert.ok(sl.matchesWindow(run, act(1, "2026-11-10", 420 - 90)), "up to two hours early"); assert.equal(sl.matchesWindow(run, act(1, "2026-11-10", 420 - 130)), false);
  assert.ok(sl.matchesWindow(run, act(1, "2026-11-10", 480 + 170))); assert.equal(sl.matchesWindow(run, act(1, "2026-11-10", 480 + 190)), false);
  // closest pairing wins, each activity and session is used once
  const two = [mk("a", "Run", "2026-11-10", 420, 480), mk("b", "Run", "2026-11-10", 480, 540)];
  assert.deepEqual(sl.matchSessions(two, [act(1, "2026-11-10", 485), act(2, "2026-11-10", 425)], new Set()).sort((x, y) => x.sessionId.localeCompare(y.sessionId)), [{ sessionId: "a", activityId: 2 }, { sessionId: "b", activityId: 1 }], "each activity goes to the session it started closest to");
  assert.deepEqual(sl.matchSessions([run], [act(1, "2026-11-10", 425), act(2, "2026-11-10", 450)], new Set()), [{ sessionId: "a", activityId: 1 }], "one activity per session");
  assert.deepEqual(sl.matchSessions([run], [act(1, "2026-11-10", 425)], new Set([1])), [], "an activity already linked elsewhere is not reused");
  assert.deepEqual(sl.matchSessions([mk("a", "Run", "2026-11-10", 420, 480, { actual: { id: 9 } })], [act(1, "2026-11-10", 425)], new Set()), [], "a linked session is left alone");
  assert.deepEqual(sl.matchSessions([mk("a", "Run", "2026-11-10", 420, 480, { status: "skipped" })], [act(1, "2026-11-10", 425)], new Set()), [], "a skipped session is left alone");
  assert.ok(sl.completes(60, 2520) && !sl.completes(60, 2400), "42 of 60 minutes is enough, 40 is not"); assert.equal(sl.completes(60, null), false);
  assert.equal(sl.actualLine({ id: 1, name: "x", sport: "Run", distanceM: 5000, movingS: 1500, avgHr: 150, start: "" }), "Actual: 3.1 mi in 25:00, 8:03 /mi, avg HR 150 (Strava)");
  assert.equal(sl.stravaUrl(20796624826), "https://www.strava.com/activities/20796624826");
  assert.equal(sl.actualLine({ id: 1, name: "Lift", sport: "WeightTraining", distanceM: null, movingS: 3725, avgHr: null, start: "" }), "Actual: 1:02:05 (Strava)", "no distance, no pace");
}

// ---- Session plan notes: structure for display and for the calendar body
{
  const sn = await import("../lib/session-note-core.ts");
  const flat = sn.parseSessionNote("Bench 4×5–6, weighted pull-up 4×5–8, single-leg glute bridge (floor, 50 lb DB on hip, 1 s pause at top) 3×12–15/leg, Pallof 3×10/side.");
  assert.deepEqual(flat.map((b) => b.kind), ["bullet", "bullet", "bullet", "bullet"], "a comma list becomes bullets");
  assert.equal(flat[2]!.text, "single-leg glute bridge (floor, 50 lb dumbbell on hip, 1 s pause at top) 3×12–15/leg", "commas inside brackets do not split");
  assert.equal(flat[3]!.text, "Pallof 3×10/side", "the closing full stop is dropped");
  assert.deepEqual(sn.parseSessionNote("1 mi WU, 2×1.5 mi @ 7:10–7:20 w/ 2:00 jog, 1 mi CD.").map((b) => b.text), ["1 mi warm-up", "2×1.5 mi @ 7:10–7:20 with 2:00 jog", "1 mi cool-down"]);
  assert.deepEqual(sn.parseSessionNote("Easy pace, then 4×20 s strides."), [{ kind: "text", text: "Easy pace, then 4×20 s strides." }], "two parts stay a sentence");
  assert.equal(sn.spellOut("1 mi WU, CD to 6, 50 lb DB, bench @ RPE 7.5, WUMPUS"), "1 mi warm-up, cool-down to 6, 50 lb dumbbell, bench @ effort 7.5 out of 10, WUMPUS", "shorthand is written out; whole words are untouched");
  assert.deepEqual(sn.parseSessionNote("Warm-up:\n- WU 5 min\n- Squat RPE 7 w/ pause").map((b) => b.text), ["Warm-up", "warm-up 5 min", "Squat effort 7 out of 10 with pause"]);
  assert.match(sn.NOTE_FORMAT, /warm-up and cool-down \(not WU or CD\)/);
  assert.deepEqual(sn.parseSessionNote("  "), []); assert.deepEqual(sn.parseSessionNote(null), []);
  const coach = sn.parseSessionNote("Warm-up:\n- 5 min easy jog\n- Leg swings\n\n## Main set\n* Back squat: 4 x 5 @ RPE 7, rest 2-3 min\n2) Pull-up 3 x 6\nCues: brace, slow down\nStay smooth.");
  assert.deepEqual(coach.map((b) => b.kind), ["heading", "bullet", "bullet", "heading", "bullet", "bullet", "text", "text"], "headings, bullets and plain lines are told apart");
  assert.equal(coach[0]!.text, "Warm-up"); assert.equal(coach[3]!.text, "Main set"); assert.equal(coach[4]!.text, "Back squat: 4 x 5 @ effort 7 out of 10, rest 2-3 min", "a colon inside a bullet is not a heading"); assert.equal(coach[5]!.text, "Pull-up 3 x 6");
  assert.equal(sn.noteToText(coach), "Warm-up:\n- 5 min easy jog\n- Leg swings\n\nMain set:\n- Back squat: 4 x 5 @ effort 7 out of 10, rest 2-3 min\n- Pull-up 3 x 6\nCues: brace, slow down\nStay smooth.");
  assert.match(sn.NOTE_FORMAT, /Warm-up/);
}
