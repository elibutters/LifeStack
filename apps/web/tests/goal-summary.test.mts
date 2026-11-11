// The short per-goal summary an agent reads instead of every session of every goal. Pure; run with `pnpm test`.
import assert from "node:assert/strict";
import { summarizeGoals } from "../lib/goal-summary-core.ts";

const NOW = new Date("2026-11-11T20:00:00Z");
const goal = (id: string, title: string, status: string, extra: Record<string, unknown> = {}) => ({ id, title, thesis: "Why it matters.", kind: "train", targetDay: null, mode: "ask", status, config: {}, notionPageId: null, doneNote: null, createdAt: "2026-10-01T00:00:00.000Z", ...extra }) as any;
const sess = (goalId: string, id: string, title: string, status: string, startIso: string, minutes = 60, extra: Record<string, unknown> = {}) => {
  const start = new Date(startIso);
  return { id, goalId, title, start, end: new Date(start.getTime() + minutes * 60_000), durationMin: minutes, status, day: startIso.slice(0, 10), note: "x".repeat(300), outlookEventId: "evt", movedFrom: [], doneAt: null, minutes: null, rating: null, logNote: null, actual: null, skippedAt: null, bodyV: null, ...extra } as any;
};

const goals = [goal("g1", "Half marathon", "active"), goal("g2", "Lifting", "active", { notionPageId: "abcd-1234", thesis: "T".repeat(500) }), goal("g3", "Prep", "done"), goal("g4", "Old idea", "archived"), goal("g5", "New thing", "draft")];
const sessions = [
  sess("g1", "a", "Easy run", "done", "2026-11-09T22:00:00Z", 40, { doneAt: "2026-11-09T22:40:00.000Z", minutes: 45 }),
  sess("g1", "b", "Long run", "done", "2026-11-10T15:00:00Z", 90, { doneAt: "2026-11-10T16:30:00.000Z" }),
  sess("g1", "c", "Missed run", "planned", "2026-11-08T22:00:00Z", 40),                 // over more than an hour ago, not done
  sess("g1", "d", "Tomorrow run", "planned", "2026-11-12T22:00:00Z", 40),
  sess("g1", "e", "Next week run", "planned", "2026-11-18T22:00:00Z", 40),
  sess("g1", "f", "Skipped one", "skipped", "2026-11-07T22:00:00Z"),
  sess("g1", "g", "Replaced one", "replaced", "2026-11-12T22:00:00Z"),
  sess("g2", "h", "Lower", "done", "2026-11-11T19:00:00Z", 60, { doneAt: "2026-11-11T20:00:00.000Z" }),
  sess("g2", "i", "Upper", "planned", "2026-11-12T23:30:00Z", 50),
  sess("g3", "j", "Old session", "done", "2026-10-01T22:00:00Z"),
];

// ---- default: active and draft goals, active first
let r = summarizeGoals(goals, sessions, undefined, NOW);
assert.deepEqual(r.goals.map((g) => g.title), ["Half marathon", "Lifting", "New thing"], "active first, then drafts; done and archived left out");
assert.deepEqual(r.hidden, { done: 1, archived: 1 }, "it says what it hid");

const run = r.goals[0]!;
assert.deepEqual(run.sessions, { planned: 3, missed: 1, done: 2, skipped: 1, minutesDone: 135 }, "counts; replaced is not counted; minutes use what was spent, else the plan");
assert.equal(run.next!.id, "d", "the next planned session that has not ended");
assert.deepEqual(Object.keys(run.next!).sort(), ["end", "id", "minutes", "start", "title"], "a short row, no notes");
assert.equal(run.lastDone!.id, "b", "the most recently finished");
assert.equal(run.notebook, null);

const lift = r.goals[1]!;
assert.equal(lift.thesis.length, 200); assert.ok(lift.thesis.endsWith("…"), "a long thesis is cut");
assert.equal(lift.notebook, "https://www.notion.so/abcd1234");
assert.deepEqual(r.goals[2]!.sessions, { planned: 0, missed: 0, done: 0, skipped: 0, minutesDone: 0 }); assert.equal(r.goals[2]!.next, null); assert.equal(r.goals[2]!.lastDone, null);

// ---- filters
assert.deepEqual(summarizeGoals(goals, sessions, "done", NOW).goals.map((g) => g.title), ["Prep"]);
assert.deepEqual(summarizeGoals(goals, sessions, "archived", NOW).goals.map((g) => g.title), ["Old idea"]);
assert.deepEqual(summarizeGoals(goals, sessions, "all", NOW).goals.map((g) => g.title), ["Half marathon", "Lifting", "New thing", "Prep", "Old idea"]);
assert.deepEqual(summarizeGoals(goals, sessions, "all", NOW).hidden, {});
assert.deepEqual(summarizeGoals([], [], undefined, NOW), { goals: [], hidden: {} });

// ---- the point: it stays small however many sessions, however long their notes
const many = Array.from({ length: 200 }, (_, i) => sess("g2", `m${i}`, `Session ${i}`, i % 2 ? "done" : "planned", new Date(Date.UTC(2026, 9, 1 + (i % 28), 22)).toISOString(), 60, { note: "plan ".repeat(400), noteBlocks: Array(20).fill({ kind: "bullet", text: "x".repeat(80) }) }));
const big = JSON.stringify(summarizeGoals(goals, many, undefined, NOW));
assert.ok(big.length < 3000, `200 long sessions still summarise in ${big.length} bytes`);
console.log("goal-summary tests passed");
