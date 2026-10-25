import "server-only";
import { asc, sql } from "drizzle-orm";
import { after } from "next/server";
import { notes } from "@lifestack/db";
import { db } from "./db";
import { TZ } from "./dates";
import { getGoal, updateGoal, type Goal } from "./goals";
import { logBlocks, notebookBlocks, notebookUrl, pageTitleOf, planBlocks, type Block } from "./goals-notion-core";
import { withNotion } from "./notion-sync";
import { loadOverrides } from "./settings-store";
import { resolveAll, valueOf } from "./settings-core";

// A Notion notebook for each goal: a page under the owner's "Goals" page with the thesis, a place to brainstorm and a running log that
// fills in as the goal moves. It needs the Notion integration to have Insert and Update content switched on (and the Goals page shared
// with it). Everything here is best-effort: a Notion problem is reported, never allowed to block a session action.
export type NotebookState = "ok" | "exists" | "no_parent" | "no_notebook" | "not_connected" | "expired" | "needs_write" | "not_found" | "failed";
export const NOTEBOOK_HELP: Record<string, string> = {
  no_parent: 'Create a page titled "Goals" in Notion, share it with Life Stack, and press Sync on the Connections page so it is copied.',
  needs_write: "Turn on Insert content and Update content for the integration in Notion, then reconnect Notion on the Connections page.",
  expired: "Notion sign-in expired. Reconnect Notion on the Connections page.",
  not_connected: "Notion is not connected.",
  not_found: "Notion could not find the page. Check it is still shared with Life Stack.",
};

// The page notebooks go under: the preference if set, otherwise the page called Goals that was copied from Notion.
export async function findGoalsParent(): Promise<string | null> {
  const set = valueOf(resolveAll(await loadOverrides()), "goals.notionParent");
  if (set) return set;
  const rows = await db().select({ sourceId: notes.sourceId }).from(notes).where(sql`lower(${notes.title}) = 'goals'`).orderBy(sql`${notes.parentId} is not null`, asc(notes.id)).limit(1);
  return rows[0] ? rows[0].sourceId.replace(/^page:/, "") : null;
}

export async function ensureNotebook(goalId: string): Promise<{ state: NotebookState; url?: string; help?: string }> {
  const found = await getGoal(goalId);
  if (!found) return { state: "failed" };
  const g = found.goal;
  if (g.notionPageId) return { state: "exists", url: notebookUrl(g.notionPageId) };
  const parent = await findGoalsParent();
  if (!parent) return { state: "no_parent", help: NOTEBOOK_HELP.no_parent };
  const r = await withNotion((call) =>
    call("POST", "/v1/pages", { parent: { type: "page_id", page_id: parent }, properties: { title: { title: [{ type: "text", text: { content: pageTitleOf(g.title) } }] } }, children: notebookBlocks(g) }),
  );
  if (!r.ok) return { state: r.reason, help: NOTEBOOK_HELP[r.reason] };
  const id = (r.value as { id?: unknown })?.id;
  if (typeof id !== "string") return { state: "failed" };
  await updateGoal(goalId, { notionPageId: id });
  return { state: "ok", url: notebookUrl(id) };
}

export async function appendToNotebook(goalId: string, blocks: Block[]): Promise<NotebookState> {
  const found = await getGoal(goalId);
  const pageId = found?.goal.notionPageId;
  if (!pageId) return "no_notebook";
  const r = await withNotion((call) => call("PATCH", `/v1/blocks/${pageId}/children`, { children: blocks }));
  return r.ok ? "ok" : r.reason;
}

// ---- the log: what happened, written as it happens
const when = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const dayLabel = (d = new Date()) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(d);

type S = { goalId: string; title: string; start: string; minutes: number; minutesSpent?: number | null; rating?: number | null; movedFrom?: string[] };
export type GoalEvent =
  | { type: "committed"; goalId: string; sessions: Pick<S, "title" | "start" | "minutes">[] }
  | { type: "done"; session: S; note?: string }
  | { type: "skipped"; session: S }
  | { type: "moved"; session: S };

export function describeEvent(e: GoalEvent, now = new Date()): { goalId: string; blocks: Block[] } {
  const day = dayLabel(now);
  switch (e.type) {
    case "committed":
      return { goalId: e.goalId, blocks: planBlocks(day, e.sessions.map((s) => `${when(s.start)}: ${s.title} (${s.minutes} min)`)) };
    case "done": {
      const s = e.session;
      const bits = [`Done: ${s.title}`, s.minutesSpent ? ` (${s.minutesSpent} min)` : "", s.rating ? `, rated ${s.rating}/5` : "", e.note ? `. ${e.note}` : ""].join("");
      return { goalId: s.goalId, blocks: logBlocks(day, bits) };
    }
    case "skipped":
      return { goalId: e.session.goalId, blocks: logBlocks(day, `Skipped: ${e.session.title} (was ${when(e.session.start)})`) };
    case "moved": {
      const from = e.session.movedFrom?.at(-1);
      return { goalId: e.session.goalId, blocks: logBlocks(day, `Moved: ${e.session.title}${from ? ` from ${when(from)}` : ""} to ${when(e.session.start)}`) };
    }
  }
}

// Runs after the response has gone out when in a request (so nothing waits on Notion), otherwise in the background. Never throws.
export function afterResponse(fn: () => Promise<unknown>) {
  const run = () => fn().catch(() => {});
  try {
    after(run);
  } catch {
    void run();
  }
}

// Called after the main action has already succeeded. Never throws.
export async function notebookHook(e: GoalEvent): Promise<NotebookState> {
  try {
    const d = describeEvent(e);
    return await appendToNotebook(d.goalId, d.blocks);
  } catch {
    return "failed";
  }
}

export type { Goal };
