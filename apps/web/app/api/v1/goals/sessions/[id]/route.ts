import { afterResponse, notebookHook } from "@/lib/goals-notion";
import { handleSessionAction } from "@/lib/goals";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // updating the calendar can take a moment

export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  handleSessionAction(req, (await params).id, (e) => {
    const s = e.session;
    afterResponse(() => notebookHook(e.action === "done" ? { type: "done", session: s, note: e.note } : e.action === "skip" ? { type: "skipped", session: s } : { type: "moved", session: s }));
  });
