import "server-only";
import { after } from "next/server";
import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { notes } from "@lifestack/db";
import { db } from "./db";
import { describeError } from "./errors";
import { snippetAround } from "./notion-core";
import { syncNotionIfStale } from "./notion-sync";
import { verifyBearer } from "./tokens";

// Reading the copied Notion pages: search and one note, for the web page, the API (scope notes:read) and the MCP tools.
export const NoteSearch = z.object({ q: z.string().trim().max(100).optional(), limit: z.number().int().min(1).max(50).default(20) });
export type NoteSearchArgs = z.input<typeof NoteSearch>;

// Keeps notes fresh without making the read wait: after the response when running in a request, otherwise just in the background.
export function kickSync() {
  try {
    after(() => syncNotionIfStale());
  } catch {
    void syncNotionIfStale();
  }
}

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function searchNotes(input: NoteSearchArgs) {
  const a = NoteSearch.parse(input);
  const rows = await db()
    .select()
    .from(notes)
    .where(a.q ? or(ilike(notes.title, like(a.q)), ilike(notes.bodyText, like(a.q))) : undefined)
    .orderBy(sql`${notes.editedAt} desc nulls last`, desc(notes.id))
    .limit(a.limit);
  return rows.map((r) => ({ id: r.id, title: r.title, url: r.url, editedAt: r.editedAt?.toISOString() ?? null, parent: r.parentId, snippet: snippetAround(r.bodyText, a.q) }));
}

export async function getNote(id: number) {
  const [r] = await db().select().from(notes).where(eq(notes.id, id));
  return r ? { id: r.id, title: r.title, url: r.url, editedAt: r.editedAt?.toISOString() ?? null, parent: r.parentId, body: r.bodyText } : null;
}

// ---- API (/api/v1/notes*), bearer scope notes:read
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function guarded(req: Request, fn: () => Promise<Response>): Promise<Response> {
  const auth = await verifyBearer(req.headers.get("authorization"), "notes:read");
  if (!auth.ok) return json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, auth.status);
  try {
    kickSync();
    return await fn();
  } catch (e) {
    console.error("notes: api failed", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}

export const handleNotesSearch = (req: Request) =>
  guarded(req, async () => {
    const p = new URL(req.url).searchParams;
    const parsed = NoteSearch.safeParse({ q: p.get("q") ?? undefined, limit: p.get("limit") ? Number(p.get("limit")) : undefined });
    if (!parsed.success) return json({ error: "invalid", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
    return json({ notes: await searchNotes(parsed.data) });
  });

export const handleNoteOne = (req: Request, rawId: string) =>
  guarded(req, async () => {
    const id = /^\d{1,15}$/.test(rawId) ? Number(rawId) : 0;
    const n = id ? await getNote(id) : null;
    return n ? json(n) : json({ error: "not_found" }, 404);
  });
