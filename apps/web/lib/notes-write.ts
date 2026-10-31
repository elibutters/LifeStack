import "server-only";
import { eq } from "drizzle-orm";
import { notes } from "@lifestack/db";
import { db } from "./db";
import { notionUrl, textToBlocks, validId } from "./notion-core";
import { withNotion } from "./notion-sync";

// Agents adding to the owner's Notion pages. Only pages already copied from Notion (so shared with the integration) can be
// targeted, and the only operations are appending to the end of a page and creating a child page: nothing is edited or deleted.
export type WriteState = "ok" | "invalid" | "no_such_note" | "not_connected" | "expired" | "needs_write" | "not_found" | "failed";
export const WRITE_HELP: Partial<Record<WriteState, string>> = {
  invalid: "Text is required, up to 20,000 characters and 100 lines.",
  no_such_note: "No such note. Use search_notes for an id.",
  needs_write: "Turn on Insert content and Update content for the integration in Notion, then reconnect Notion on the Connections page.",
  expired: "Notion sign-in expired. Reconnect Notion on the Connections page.",
  not_connected: "Notion is not connected.",
  not_found: "Notion could not find the page. Check it is still shared with Life Stack.",
};
export type WriteResult = { state: WriteState; url?: string; help?: string };
const done = (state: WriteState, url?: string): WriteResult => ({ state, url, help: WRITE_HELP[state] });

async function pageIdOf(noteId: number): Promise<string | null> {
  const [r] = await db().select({ sourceId: notes.sourceId }).from(notes).where(eq(notes.id, noteId));
  const id = r?.sourceId.replace(/^page:/, "");
  return id && validId(id) ? id : null;
}

export async function appendToNote(noteId: number, text: string): Promise<WriteResult> {
  const children = textToBlocks(text);
  if (!children) return done("invalid");
  const pageId = await pageIdOf(noteId);
  if (!pageId) return done("no_such_note");
  const r = await withNotion((call) => call("PATCH", `/v1/blocks/${pageId}/children`, { children }));
  return r.ok ? done("ok", notionUrl(pageId)) : done(r.reason);
}

export async function addNotePage(parentNoteId: number, title: string, text: string): Promise<WriteResult> {
  const name = title.trim().slice(0, 200);
  const children = text.trim() ? textToBlocks(text) : [];
  if (!name || !children) return done("invalid");
  const parent = await pageIdOf(parentNoteId);
  if (!parent) return done("no_such_note");
  const r = await withNotion((call) => call("POST", "/v1/pages", { parent: { type: "page_id", page_id: parent }, properties: { title: { title: [{ type: "text", text: { content: name } }] } }, children }));
  if (!r.ok) return done(r.reason);
  const id = (r.value as { id?: unknown })?.id;
  return typeof id === "string" ? done("ok", notionUrl(id)) : done("failed");
}
