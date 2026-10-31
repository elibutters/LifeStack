import { z } from "zod";

// Pure rules for the Notion copy: no network, no database. A page becomes one note: its title, link, edit time, parent and the
// plain text of its blocks (paragraphs, headings, lists, to-dos, quotes, callouts, code, toggles), capped. Files and media are left out.
export const NOTION_VERSION = "2026-03-11";
export const BODY_CAP = 6000;
export const MAX_DEPTH = 5;
export const MAX_PAGES = 2000;

export type Block = { id?: string; type?: string; has_children?: boolean; last_edited_time?: string; [k: string]: unknown };
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});

export const richText = (rt: unknown): string => (Array.isArray(rt) ? rt.map((x) => (typeof rec(x).plain_text === "string" ? (rec(x).plain_text as string) : "")).join("") : "");

export const pageSourceId = (id: string) => `page:${id}`;
export const notionUrl = (id: string) => `https://www.notion.so/${id.replace(/-/g, "")}`;
export const isTrashed = (o: unknown) => rec(o).in_trash === true || rec(o).archived === true;
const uuid = (v: unknown): string | null => (typeof v === "string" && /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(v) ? v : null);
export const validId = uuid;

// The title is whichever property has type "title".
export function pageTitle(page: unknown): string {
  for (const p of Object.values(rec(rec(page).properties))) if (rec(p).type === "title") return richText(rec(p).title).trim() || "Untitled";
  return "Untitled";
}
export const dataSourceTitle = (ds: unknown): string => richText(rec(ds).title).trim() || "Untitled";

// Where a page lives, as a short stable reference. The workspace root has none.
export function parentRef(parent: unknown): string | null {
  const p = rec(parent);
  switch (p.type) {
    case "page_id": return typeof p.page_id === "string" ? `page:${p.page_id}` : null;
    case "data_source_id": return typeof p.data_source_id === "string" ? `data_source:${p.data_source_id}` : null;
    case "database_id": return typeof p.database_id === "string" ? `database:${p.database_id}` : null;
    case "block_id": return typeof p.block_id === "string" ? `block:${p.block_id}` : null;
    default: return null;
  }
}

const TEXT_TYPES = new Set(["paragraph", "heading_1", "heading_2", "heading_3", "callout", "code", "toggle", "bulleted_list_item", "numbered_list_item", "to_do", "quote"]);

// One block as a line of text, or null for anything that has none (files, media, embeds, dividers, child pages).
export function blockText(b: Block, number = 1): string | null {
  const type = b.type ?? "";
  if (type === "table_row") {
    const cells = rec(b.table_row).cells;
    const line = Array.isArray(cells) ? cells.map((c) => richText(c)).join(" | ").trim() : "";
    return line.replace(/\|/g, "").trim() ? line : null;
  }
  if (!TEXT_TYPES.has(type)) return null;
  const body = rec(b[type]);
  const text = richText(body.rich_text).trim();
  if (!text) return null;
  switch (type) {
    case "bulleted_list_item": return `- ${text}`;
    case "numbered_list_item": return `${number}. ${text}`;
    case "to_do": return `[${body.checked === true ? "x" : " "}] ${text}`;
    case "quote": return `> ${text}`;
    default: return text;
  }
}

export function blocksToText(blocks: Block[]): string {
  const lines: string[] = [];
  let n = 0;
  for (const b of blocks) {
    n = b.type === "numbered_list_item" ? n + 1 : 0;
    const line = blockText(b, n || 1);
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

export const capText = (s: string, n = BODY_CAP) => (s.length > n ? s.slice(0, n) : s);

export type ChildPage = { id: string; title: string; edited: string | null; created: string | null };
export type ChildRefs = { pages: ChildPage[]; databases: { id: string; title: string }[] };

// Pages and databases that live inside a page, found from its child_page and child_database blocks.
export function childRefs(blocks: Block[]): ChildRefs {
  const out: ChildRefs = { pages: [], databases: [] };
  for (const b of blocks) {
    const id = uuid(b.id);
    if (!id) continue;
    if (b.type === "child_page") out.pages.push({ id, title: richText([{ plain_text: rec(b.child_page).title }]).trim() || "Untitled", edited: typeof b.last_edited_time === "string" ? b.last_edited_time : null, created: typeof b.created_time === "string" ? b.created_time : null });
    else if (b.type === "child_database") out.databases.push({ id, title: String(rec(b.child_database).title ?? "Untitled") });
  }
  return out;
}

// Blocks that only hold other blocks (columns, toggles); their children are read too, a couple of requests at most.
const CONTAINERS = new Set(["column_list", "column", "toggle"]);
export const containerIds = (blocks: Block[]): string[] => blocks.filter((b) => b.has_children === true && CONTAINERS.has(b.type ?? "")).map((b) => uuid(b.id)).filter((x): x is string => !!x);

export type NoteRow = { sourceId: string; title: string; url: string; editedAt: Date | null; parentId: string | null; bodyText: string; generation: number };
export type PageMeta = { title: string; edited: string | null; created?: string | null; parent: string | null; url?: string };

export function metaOfPage(page: unknown): PageMeta {
  const p = rec(page);
  return { title: pageTitle(page), edited: typeof p.last_edited_time === "string" ? p.last_edited_time : null, created: typeof p.created_time === "string" ? p.created_time : null, parent: parentRef(p.parent), url: typeof p.url === "string" ? p.url : undefined };
}

const ms = (iso: string | null | undefined) => { const t = iso ? Date.parse(iso) : NaN; return Number.isNaN(t) ? null : t; };

// When the page's own text last changed. Notion marks a page as edited when it is shared with an integration, so on its own the
// page's last_edited_time says "just now" for everything shared at once. The content blocks keep their real times, so the page
// counts as edited when its content did (blocks of other pages, like child pages, are left out), or when it was created if it has none.
export function effectiveEdited(pageEdited: string | null, created: string | null | undefined, blocks: Block[]): string | null {
  const content = blocks.filter((b) => b.type !== "child_page" && b.type !== "child_database").map((b) => ms(b.last_edited_time)).filter((t): t is number => t !== null);
  const contentTime = content.length ? Math.max(...content) : ms(created);
  const page = ms(pageEdited);
  if (contentTime === null) return pageEdited;
  if (page === null) return new Date(contentTime).toISOString();
  return new Date(Math.min(page, contentTime)).toISOString();
}

export function noteRow(id: string, meta: PageMeta, body: string, generation: number): NoteRow {
  const edited = meta.edited ? new Date(meta.edited) : null;
  return {
    sourceId: pageSourceId(id),
    title: meta.title.slice(0, 300),
    url: meta.url ?? notionUrl(id),
    editedAt: edited && !Number.isNaN(edited.getTime()) ? edited : null,
    parentId: meta.parent,
    bodyText: capText(body),
    generation,
  };
}

// ---- the walk: a queue of things still to read, kept as JSON in sync_state.cursor
export type Item =
  | { k: "search"; filter: "page" | "data_source"; cursor?: string }
  | { k: "ds"; id: string; depth: number; cursor?: string }
  | { k: "db"; id: string; depth: number }
  | { k: "page"; id: string; depth: number; meta?: PageMeta };

export type WalkCursor = { gen: number; active: boolean; queue: Item[]; count: number; tried?: string };

const ItemSchema = z.union([
  z.object({ k: z.literal("search"), filter: z.enum(["page", "data_source"]), cursor: z.string().optional() }),
  z.object({ k: z.literal("ds"), id: z.string(), depth: z.number(), cursor: z.string().optional() }),
  z.object({ k: z.literal("db"), id: z.string(), depth: z.number() }),
  z.object({ k: z.literal("page"), id: z.string(), depth: z.number(), meta: z.object({ title: z.string(), edited: z.string().nullable(), created: z.string().nullable().optional(), parent: z.string().nullable(), url: z.string().optional() }).optional() }),
]);
const CursorSchema = z.object({ gen: z.number().int().min(0), active: z.boolean(), queue: z.array(ItemSchema), count: z.number().int().min(0), tried: z.string().optional() });

export const freshWalk = (gen: number): WalkCursor => ({ gen, active: true, queue: [{ k: "search", filter: "page" }, { k: "search", filter: "data_source" }], count: 0 });

export function readCursor(raw: string | null | undefined): WalkCursor {
  try {
    const p = CursorSchema.safeParse(raw ? JSON.parse(raw) : null);
    if (p.success) return p.data as WalkCursor;
  } catch {
    // fall through to a clean start
  }
  return { gen: 0, active: false, queue: [], count: 0 };
}

// What is kept encrypted in connections.refresh_token_enc: both tokens, as JSON.
export const StoredTokens = z.object({ access: z.string().min(1), refresh: z.string().min(1) });
export type StoredTokensT = z.infer<typeof StoredTokens>;
export function parseStored(json: string): StoredTokensT | null {
  try {
    const p = StoredTokens.safeParse(JSON.parse(json));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

// A short excerpt around the first match of q (or the start of the text), for search results.
export function snippetAround(text: string, q: string | undefined, n = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!q) return flat.slice(0, n);
  const at = flat.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return flat.slice(0, n);
  const start = Math.max(0, at - Math.floor(n / 3));
  return `${start > 0 ? "..." : ""}${flat.slice(start, start + n)}${start + n < flat.length ? "..." : ""}`;
}

// ---- writing: plain text to Notion blocks. Lines starting "# ", "## " or "### " become headings and "- " or "* " bullets; every
// other non-empty line is a paragraph. Notion limits one piece of rich text to 2,000 characters, so long lines are split.
export const WRITE_MAX_CHARS = 20_000;
export const WRITE_MAX_BLOCKS = 100;

const pieces = (text: string, size = 1900) => {
  const out: { type: "text"; text: { content: string } }[] = [];
  for (let i = 0; i < text.length; i += size) out.push({ type: "text", text: { content: text.slice(i, i + size) } });
  return out;
};

export function textToBlocks(input: string): Record<string, unknown>[] | null {
  if (input.length > WRITE_MAX_CHARS) return null;
  const blocks: Record<string, unknown>[] = [];
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(#{1,3}) +(.+)$/.exec(line);
    const b = /^[-*] +(.+)$/.exec(line);
    const [type, text] = m ? [`heading_${m[1]!.length}`, m[2]!] : b ? ["bulleted_list_item", b[1]!] : ["paragraph", line];
    blocks.push({ object: "block", type, [type]: { rich_text: pieces(text) } });
  }
  return blocks.length > 0 && blocks.length <= WRITE_MAX_BLOCKS ? blocks : null;
}
