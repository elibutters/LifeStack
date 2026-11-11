import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { events } from "@lifestack/db";
import { db } from "./db";
import { listGoals, refreshCalendar, sessionsOf } from "./goals";
import { notebookUrl } from "./goals-notion-core";
import { deleteEvent as deleteOutlookEvent, NEEDS_WRITE } from "./outlook-write";

// Deleting a goal cannot be undone, so it is deliberate: the goal must already be archived (or never started, a draft), the caller must give
// its exact title back, and a goal with finished sessions is refused unless deleting that history is asked for outright. Its sessions go with
// it, and so do their Outlook events. The Notion notebook is never touched (Life Stack does not delete in Notion); its address is returned so
// the owner can remove the page.
const Input = z.object({ confirmTitle: z.string(), deleteHistory: z.boolean().optional() });
const WHY: Record<string, string> = { not_connected: "Outlook is not connected", needs_reconnect: NEEDS_WRITE, failed: "Outlook did not respond" };

export async function deleteGoal(id: string, input: unknown) {
  const p = Input.safeParse(input);
  if (!p.success) return { ok: false as const, error: "confirmTitle is required: the goal's exact title." };
  const goal = (await listGoals()).find((g) => g.id === id);
  if (!goal) return { ok: false as const, error: "No such goal." };
  if (goal.status !== "archived" && goal.status !== "draft") return { ok: false as const, error: `That goal is ${goal.status}. Archive it first (update_goal with status archived), then delete it.` };
  if (p.data.confirmTitle.trim() !== goal.title) return { ok: false as const, error: "confirmTitle does not match the goal's title exactly. Nothing was deleted." };

  const sessions = await sessionsOf(id);
  const done = sessions.filter((s) => s.status === "done");
  if (done.length > 0 && !p.data.deleteHistory) {
    return { ok: false as const, error: `That goal has ${done.length} finished session${done.length === 1 ? "" : "s"}, which are history. Nothing was deleted. Keep it archived, or pass deleteHistory to delete the history too.` };
  }

  // Outlook first. Anything that cannot be removed stops the whole thing before a single record is deleted, so nothing is left half done;
  // an event already gone counts as removed, so a retry picks up where this left off.
  let removed = 0;
  for (const s of sessions) {
    if (!s.outlookEventId) continue;
    const r = await deleteOutlookEvent(s.outlookEventId);
    if (!r.ok) return { ok: false as const, error: `Could not remove "${s.title}" from the calendar (${WHY[r.reason] ?? WHY.failed}). Nothing else was deleted; try again once that is fixed.` };
    removed++;
  }
  await db().delete(events).where(and(eq(events.source, "goals"), or(eq(events.sourceId, `goal:${id}`), sql`${events.payload}->>'goalId' = ${id}`)));
  if (removed > 0) refreshCalendar();
  return {
    ok: true as const,
    deleted: { title: goal.title, sessions: sessions.length, finished: done.length, calendarEvents: removed },
    notebook: goal.notionPageId ? notebookUrl(goal.notionPageId) : null,
  };
}
