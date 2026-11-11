// A short summary per goal, for an agent that only needs to know what goals exist and where each stands. The full list of sessions was 90+ KB
// across a handful of goals (every session with its note blocks), far more than an agent can read; get_goal has one goal's sessions and
// get_sessions finds sessions by day. Pure: no database here.
import type { Goal, Session } from "./goals";
import { statusAt } from "./goals-core";
import { notebookUrl } from "./goals-notion-core";

export type StatusFilter = "active" | "draft" | "done" | "archived" | "all";
const ORDER: Record<string, number> = { active: 0, draft: 1, done: 2, archived: 3 };

const brief = (s: Session) => ({ id: s.id, title: s.title, start: s.start.toISOString(), end: s.end.toISOString(), minutes: s.durationMin });
const cut = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

// Goals matching `status` (default: active and draft), each with its counts, its next planned session and its last finished one. `hidden`
// says how many goals the filter left out, so an agent knows when to ask for more.
export function summarizeGoals(goals: Goal[], sessions: Session[], status: StatusFilter | undefined, now: Date) {
  const shows = (g: Goal) => (status === "all" ? true : status ? g.status === status : g.status === "active" || g.status === "draft");
  const by = new Map<string, Session[]>();
  for (const s of sessions) by.set(s.goalId, [...(by.get(s.goalId) ?? []), s]);
  const hidden: Record<string, number> = {};
  for (const g of goals) if (!shows(g)) hidden[g.status] = (hidden[g.status] ?? 0) + 1;

  const out = goals.filter(shows)
    .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9))
    .map((g) => {
      const list = (by.get(g.id) ?? []).slice().sort((a, b) => a.start.getTime() - b.start.getTime());
      const planned = list.filter((s) => s.status === "planned");
      const done = list.filter((s) => s.status === "done");
      const next = planned.find((s) => s.end > now);
      const last = done.slice().sort((a, b) => (b.doneAt ? Date.parse(b.doneAt) : b.start.getTime()) - (a.doneAt ? Date.parse(a.doneAt) : a.start.getTime()))[0];
      return {
        id: g.id, title: g.title, status: g.status, kind: g.kind, mode: g.mode, targetDay: g.targetDay,
        thesis: cut(g.thesis, 200),
        notebook: g.notionPageId ? notebookUrl(g.notionPageId) : null,
        sessions: {
          planned: planned.length,
          missed: planned.filter((s) => statusAt({ status: s.status, end: s.end }, now) === "missed").length,
          done: done.length,
          skipped: list.filter((s) => s.status === "skipped").length,
          minutesDone: done.reduce((n, s) => n + (s.minutes ?? s.durationMin), 0),
        },
        next: next ? brief(next) : null,
        lastDone: last ? { ...brief(last), doneAt: last.doneAt } : null,
      };
    });
  return { goals: out, hidden };
}
