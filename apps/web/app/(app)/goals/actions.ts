"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { completeSession, moveSession, refreshEventBodies, skipSession } from "@/lib/goals";
import { afterResponse, ensureNotebook, notebookHook } from "@/lib/goals-notion";

// Every action checks the session itself (server actions are POSTs to the page) and goes back to /goals with a short note when
// something could not be done, so a refusal is never silent.
const back = (note?: string) => {
  revalidatePath("/goals");
  redirect(note ? `/goals?note=${encodeURIComponent(note.slice(0, 200))}` : "/goals");
};
const idOf = (f: FormData) => String(f.get("id") ?? "").trim();

export async function doneAction(form: FormData): Promise<void> {
  await requireSession();
  const minutes = Number(form.get("minutes"));
  const r = await completeSession(idOf(form), Number.isInteger(minutes) && minutes > 0 ? { minutes } : {});
  if (!r.ok) return back(r.error);
  afterResponse(() => notebookHook({ type: "done", session: r.session }));
  back();
}

export async function skipAction(form: FormData): Promise<void> {
  await requireSession();
  const r = await skipSession(idOf(form));
  if (!r.ok) return back(r.error);
  afterResponse(() => notebookHook({ type: "skipped", session: r.session }));
  back(r.calendar === "needs_reconnect" ? "Skipped. Reconnect Outlook to take it off your calendar too." : undefined);
}

// With a start time it moves there; without one it uses the next free slot.
export async function moveAction(form: FormData): Promise<void> {
  await requireSession();
  const start = String(form.get("start") ?? "").trim();
  const r = await moveSession(idOf(form), start ? { start } : {});
  if (!r.ok) return back(r.error);
  afterResponse(() => notebookHook({ type: "moved", session: r.session }));
  back(r.calendar === "needs_reconnect" ? "Moved here. Reconnect Outlook to move it on your calendar too." : undefined);
}

export async function notebookAction(form: FormData): Promise<void> {
  await requireSession();
  const r = await ensureNotebook(String(form.get("goalId") ?? ""));
  back(r.state === "ok" || r.state === "exists" ? undefined : (r.help ?? "Could not create the notebook."));
}

// Rewrites the Outlook events of the saved sessions in the current layout; press again while some are left.
export async function refreshCalendarAction(): Promise<void> {
  await requireSession();
  const r = await refreshEventBodies({ budgetMs: 45_000 });
  if (r.calendar !== "ok") return back("Reconnect Outlook on the Connections page to let Life Stack update your calendar.");
  back(r.remaining > 0 ? `Updated ${r.updated} calendar events, ${r.remaining} left. Press the button again to continue.` : r.updated > 0 ? `Updated ${r.updated} calendar events. They are all current.` : "Every calendar event is already current.");
}
