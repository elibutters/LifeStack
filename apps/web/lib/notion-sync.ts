import "server-only";
import { and, count, eq, lt, sql } from "drizzle-orm";
import { connections, notes, syncState } from "@lifestack/db";
import { decrypt, encrypt } from "./crypto";
import { db } from "./db";
import { describeError } from "./errors";
import { NOTION_API, notionConfigured, NotionError, refreshTokens } from "./notion";
import {
  blocksToText, childRefs, containerIds, effectiveEdited, freshWalk, isTrashed, MAX_DEPTH, MAX_PAGES, metaOfPage, NOTION_VERSION, noteRow, pageSourceId, parseStored,
  readCursor, validId, type Block, type Item, type NoteRow, type PageMeta, type StoredTokensT, type WalkCursor,
} from "./notion-core";

export const NOTION = "notion";
const FRESH_MS = 15 * 60 * 1000; // sync on read if the last finished walk is older than this
const RETRY_MS = 2 * 60 * 1000; // but never more often than this, even after a failure
const MAX_REQUESTS = 40;
const BUDGET_MS = 45_000;
export const EXPIRED = "Notion sign-in expired. Reconnect Notion.";
const RATE_LIMITED = "Notion rate limit reached. It will retry.";

export type NotionRun = { pages: number; done: boolean } | { skipped: true } | { expired: true } | null;
export type RunOptions = { maxRequests?: number; budgetMs?: number; maxPages?: number; sleep?: (ms: number) => Promise<void> };

// ---- connection and state
export async function getConnection() {
  const [row] = await db().select().from(connections).where(eq(connections.provider, NOTION));
  return row ?? null;
}
export async function getSyncState() {
  const [row] = await db().select().from(syncState).where(eq(syncState.source, NOTION));
  return row ?? null;
}
async function recordState(set: { lastOkAt?: Date; lastError?: string | null; cursor?: string }) {
  await db().insert(syncState).values({ source: NOTION, ...set }).onConflictDoUpdate({ target: syncState.source, set });
}

export async function saveConnection(tokens: StoredTokensT, workspace: string | null) {
  const row = { provider: NOTION, account: workspace, refreshTokenEnc: encrypt(JSON.stringify(tokens)), updatedAt: new Date() };
  await db().insert(connections).values(row).onConflictDoUpdate({ target: connections.provider, set: row });
  await recordState({ lastError: null });
}

export async function disconnectNotion() {
  // Deleting the connection first also makes any sync that is mid-flight abandon its writes.
  await db().delete(connections).where(eq(connections.provider, NOTION));
  await db().delete(syncState).where(eq(syncState.source, NOTION));
  await db().delete(notes);
}

export async function notionStatus() {
  const [n] = await db().select({ n: count() }).from(notes);
  const state = await getSyncState();
  const cur = readCursor(state?.cursor);
  return { notes: n?.n ?? 0, lastOkAt: state?.lastOkAt ?? null, lastError: state?.lastError ?? null, walking: cur.active, queued: cur.queue.length };
}

// Only one sync runs at a time. The lease expires on its own if a run is killed mid-way.
async function claimLease(): Promise<boolean> {
  await db().insert(syncState).values({ source: NOTION }).onConflictDoNothing();
  const claimed = await db()
    .update(syncState)
    .set({ leaseUntil: sql`now() + interval '5 minutes'` })
    .where(and(eq(syncState.source, NOTION), sql`(${syncState.leaseUntil} is null or ${syncState.leaseUntil} < now())`))
    .returning({ source: syncState.source });
  return claimed.length > 0;
}
async function releaseLease() {
  try {
    await db().update(syncState).set({ leaseUntil: null }).where(eq(syncState.source, NOTION));
  } catch {
    // The lease expires by itself.
  }
}

// ---- stopping conditions, thrown inside a run
class OutOfBudget extends Error {}
class RateLimited extends Error {}
class ConnectionChanged extends Error {}

// One run's view of the API: it counts requests, watches the clock, reuses the access token until Notion says 401, then
// refreshes once, writing the new pair back (compare-and-swap on the ciphertext) before the request is retried.
class Session {
  requests = 0;
  private refreshed = false;
  private readonly started = Date.now();
  constructor(
    private tokens: StoredTokensT,
    public enc: string,
    private readonly o: Required<RunOptions>,
  ) {}

  private remaining() { return this.o.budgetMs - (Date.now() - this.started); }
  private spend() {
    if (this.requests >= this.o.maxRequests || this.remaining() <= 0) throw new OutOfBudget();
    this.requests++;
  }
  outOfTime() { return this.requests >= this.o.maxRequests || this.remaining() <= 0; }

  private async refresh() {
    this.refreshed = true;
    this.spend();
    const next = await refreshTokens(this.tokens.refresh); // invalid_grant propagates as NotionError
    const enc = encrypt(JSON.stringify({ access: next.access, refresh: next.refresh }));
    const swapped = await db()
      .update(connections)
      .set({ refreshTokenEnc: enc, updatedAt: new Date() })
      .where(and(eq(connections.provider, NOTION), eq(connections.refreshTokenEnc, this.enc)))
      .returning({ provider: connections.provider });
    if (swapped.length === 0) throw new ConnectionChanged();
    this.tokens = { access: next.access, refresh: next.refresh };
    this.enc = enc;
  }

  async call(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, query: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(`${NOTION_API}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    if (url.origin !== NOTION_API) throw new Error("refusing non-Notion URL");
    for (let attempt = 0; attempt < 4; attempt++) {
      this.spend();
      const res = await fetch(url, {
        method,
        headers: { authorization: `Bearer ${this.tokens.access}`, "notion-version": NOTION_VERSION, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      if (res.status === 401 && !this.refreshed) { await this.refresh(); continue; }
      if (res.status === 429) {
        const wait = Math.max(0, Number(res.headers.get("retry-after") ?? 1)) * 1000;
        if (!Number.isFinite(wait) || wait > this.remaining() - 3000) throw new RateLimited();
        await this.o.sleep(wait);
        continue;
      }
      if (!res.ok) throw new NotionError(res.status, res.statusText || String(res.status));
      return res.json();
    }
    throw new NotionError(429, "too many retries");
  }
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

// ---- one run
export async function syncNotion(opts: RunOptions = {}): Promise<NotionRun> {
  const o: Required<RunOptions> = { maxRequests: opts.maxRequests ?? MAX_REQUESTS, budgetMs: opts.budgetMs ?? BUDGET_MS, maxPages: opts.maxPages ?? MAX_PAGES, sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))) };
  const conn = await getConnection();
  if (!conn) return null;
  // A machine without the app's Notion credentials (a local dev server sharing the database) cannot refresh tokens, and must never
  // mark the connection expired for everyone because of that.
  if (!notionConfigured()) return null;
  if (!(await claimLease())) return { skipped: true };
  let cur: WalkCursor = readCursor(null);
  try {
    const stored = parseStored(decrypt(conn.refreshTokenEnc));
    if (!stored) {
      await recordState({ lastError: EXPIRED });
      return { expired: true };
    }
    cur = readCursor((await getSyncState())?.cursor);
    if (!cur.active) cur = freshWalk(cur.gen + 1); // each full walk gets a new generation
    cur.tried = new Date().toISOString();
    await recordState({ cursor: JSON.stringify(cur) });

    const api = new Session(stored, conn.refreshTokenEnc, o);
    let pages = 0;
    let capped = false;

    const queued = () => new Set(cur.queue.map((i) => (i.k === "page" || i.k === "ds" || i.k === "db" ? `${i.k}:${i.id}` : "")));
    let inQueue = queued();
    const enqueue = (item: Item) => {
      const key = item.k === "page" || item.k === "ds" || item.k === "db" ? `${item.k}:${item.id}` : "";
      if (key && inQueue.has(key)) return;
      if (item.k !== "search" && item.depth > MAX_DEPTH) return;
      // No point queueing more pages than we may store; say so when something was left out.
      if (item.k === "page" && cur.count + cur.queue.filter((i) => i.k === "page").length >= o.maxPages) { capped = true; return; }
      if (key) inQueue.add(key);
      cur.queue.push(item);
    };

    const writeNote = async (row: NoteRow) => {
      const ok = await db().transaction(async (tx) => {
        const [live] = await tx.select({ enc: connections.refreshTokenEnc }).from(connections).where(eq(connections.provider, NOTION)).for("share");
        if (!live || live.enc !== api.enc) return false;
        await tx.insert(notes).values(row).onConflictDoUpdate({
          target: notes.sourceId,
          set: { title: sql`excluded.title`, url: sql`excluded.url`, editedAt: sql`excluded.edited_at`, parentId: sql`excluded.parent_id`, bodyText: sql`excluded.body_text`, generation: sql`excluded.generation` },
        });
        return true;
      });
      if (!ok) throw new ConnectionChanged();
    };
    const dropNote = async (id: string) => { await db().delete(notes).where(eq(notes.sourceId, pageSourceId(id))); };

    // All the blocks directly under a block, following Notion's paging up to `maxPages` pages.
    const children = async (blockId: string, maxPageCount: number): Promise<Block[]> => {
      const out: Block[] = [];
      let start: string | undefined;
      for (let i = 0; i < maxPageCount; i++) {
        const r = obj(await api.call("GET", `/v1/blocks/${blockId}/children`, undefined, { page_size: "100", ...(start ? { start_cursor: start } : {}) }));
        out.push(...(arr(r.results) as Block[]));
        if (r.has_more !== true || typeof r.next_cursor !== "string") break;
        start = r.next_cursor;
      }
      return out;
    };

    const doPage = async (item: Extract<Item, { k: "page" }>) => {
      const id = validId(item.id);
      if (!id) return;
      const [seen] = await db().select({ g: notes.generation }).from(notes).where(eq(notes.sourceId, pageSourceId(id)));
      if (seen?.g === cur.gen) return; // already read in this walk
      let meta: PageMeta | undefined = item.meta;
      if (!meta) {
        const page = await api.call("GET", `/v1/pages/${id}`);
        if (isTrashed(page)) { await dropNote(id); return; }
        meta = metaOfPage(page);
      }
      const top = await children(id, 2);
      const nested: Block[] = [];
      for (const bid of containerIds(top).slice(0, 2)) nested.push(...(await children(bid, 1)));
      const all = [...top, ...nested];
      await writeNote(noteRow(id, { ...meta, edited: effectiveEdited(meta.edited, meta.created, all) }, blocksToText(all), cur.gen));
      cur.count++;
      pages++;
      const refs = childRefs(all);
      for (const p of refs.pages) enqueue({ k: "page", id: p.id, depth: item.depth + 1, meta: { title: p.title, edited: p.edited, created: p.created, parent: `page:${id}` } });
      for (const d of refs.databases) enqueue({ k: "db", id: d.id, depth: item.depth + 1 });
    };

    const doDataSource = async (item: Extract<Item, { k: "ds" }>) => {
      const r = obj(await api.call("POST", `/v1/data_sources/${item.id}/query`, { page_size: 100, ...(item.cursor ? { start_cursor: item.cursor } : {}) }));
      for (const row of arr(r.results)) {
        const rid = validId(obj(row).id);
        if (!rid) continue;
        if (isTrashed(row)) { await dropNote(rid); continue; }
        enqueue({ k: "page", id: rid, depth: item.depth + 1, meta: metaOfPage(row) });
      }
      return r.has_more === true && typeof r.next_cursor === "string" ? r.next_cursor : null;
    };

    const doDatabase = async (item: Extract<Item, { k: "db" }>) => {
      const db0 = obj(await api.call("GET", `/v1/databases/${item.id}`));
      if (isTrashed(db0)) return;
      for (const ds of arr(db0.data_sources)) {
        const did = validId(obj(ds).id);
        if (did) enqueue({ k: "ds", id: did, depth: item.depth });
      }
    };

    const doSearch = async (item: Extract<Item, { k: "search" }>) => {
      const r = obj(await api.call("POST", "/v1/search", { filter: { property: "object", value: item.filter }, page_size: 100, ...(item.cursor ? { start_cursor: item.cursor } : {}) }));
      for (const x of arr(r.results)) {
        const id = validId(obj(x).id);
        if (!id) continue;
        if (obj(x).object === "data_source") { if (!isTrashed(x)) enqueue({ k: "ds", id, depth: 0 }); continue; }
        if (isTrashed(x)) { await dropNote(id); continue; }
        enqueue({ k: "page", id, depth: 0, meta: metaOfPage(x) });
      }
      return r.has_more === true && typeof r.next_cursor === "string" ? r.next_cursor : null;
    };

    try {
      while (cur.queue.length > 0 && !api.outOfTime()) {
        if (cur.count >= o.maxPages) { capped = true; cur.queue = []; break; }
        const item = cur.queue[0]!;
        let next: string | null | undefined;
        if (item.k === "page") await doPage(item);
        else if (item.k === "ds") next = await doDataSource(item);
        else if (item.k === "db") await doDatabase(item);
        else next = await doSearch(item);
        // Done with this item: drop it, or keep it at the front with the cursor for its next page of results.
        if (next && (item.k === "search" || item.k === "ds")) cur.queue[0] = { ...item, cursor: next };
        else cur.queue.shift();
        inQueue = queued();
        await recordState({ cursor: JSON.stringify(cur), lastError: null });
      }
    } catch (e) {
      if (e instanceof OutOfBudget) {
        // Out of requests or time mid-item: nothing of that item was stored, so it stays queued for the next run.
      } else if (e instanceof RateLimited) {
        await recordState({ cursor: JSON.stringify(cur), lastError: RATE_LIMITED });
        return { pages, done: false };
      } else throw e;
    }

    // Only a walk that read everything may delete: anything not stamped with this generation is gone from Notion.
    if (cur.queue.length === 0) {
      cur.active = false;
      await db().transaction(async (tx) => {
        const [live] = await tx.select({ enc: connections.refreshTokenEnc }).from(connections).where(eq(connections.provider, NOTION)).for("share");
        if (!live || live.enc !== api.enc) throw new ConnectionChanged();
        await tx.delete(notes).where(lt(notes.generation, cur.gen));
      });
      await recordState({ lastOkAt: new Date(), lastError: capped ? `More than ${o.maxPages.toLocaleString("en-US")} pages are shared, so only the first ${o.maxPages.toLocaleString("en-US")} were copied.` : null, cursor: JSON.stringify(cur) });
      return { pages, done: true };
    }
    await recordState({ cursor: JSON.stringify(cur), lastError: null });
    return { pages, done: false };
  } catch (e) {
    if (e instanceof ConnectionChanged) return null; // disconnected or reconnected mid-run: abandon quietly
    if (e instanceof NotionError && (e.invalidGrant || e.status === 401)) {
      await recordState({ lastError: EXPIRED }).catch(() => {});
      return { expired: true };
    }
    console.error("notion: sync failed", describeError(e));
    await recordState({ lastError: "Sync failed. It will retry." }).catch(() => {});
    throw e;
  } finally {
    await releaseLease();
  }
}

// Called before reads and after pages render, so using the app keeps notes fresh without delaying it.
export async function syncNotionIfStale() {
  try {
    if (!(await getConnection()) || !notionConfigured()) return;
    const state = await getSyncState();
    if (state?.lastError === EXPIRED) return; // needs the owner to reconnect; retrying cannot help
    const cur = readCursor(state?.cursor);
    const now = Date.now();
    if (now - (Date.parse(cur.tried ?? "") || 0) < RETRY_MS) return;
    if (!cur.active && now - (state?.lastOkAt?.getTime() ?? 0) < FRESH_MS) return; // a walk in progress keeps going
    await syncNotion();
  } catch {
    // Recorded in sync_state; the Connections page shows it.
  }
}

export type NotionWrite<T> = { ok: true; value: T } | { ok: false; reason: "not_connected" | "expired" | "needs_write" | "not_found" | "failed" };

// Runs a few Notion calls (reads or writes) outside a sync, with the same careful token handling: reuse the access token, refresh once
// on a 401 and store the new pair by compare-and-swap. A refused write means the integration was not given the Insert and Update
// content abilities (or the page was never shared with it), which is reported plainly so the owner knows what to switch on.
export async function withNotion<T>(fn: (call: Session["call"]) => Promise<T>, opts: RunOptions = {}): Promise<NotionWrite<T>> {
  if (!notionConfigured()) return { ok: false, reason: "not_connected" };
  const o: Required<RunOptions> = { maxRequests: opts.maxRequests ?? 12, budgetMs: opts.budgetMs ?? 20_000, maxPages: 0, sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))) };
  for (let attempt = 0; attempt < 2; attempt++) {
    const conn = await getConnection();
    if (!conn) return { ok: false, reason: "not_connected" };
    const stored = parseStored(decrypt(conn.refreshTokenEnc));
    if (!stored) return { ok: false, reason: "expired" };
    const api = new Session(stored, conn.refreshTokenEnc, o);
    try {
      return { ok: true, value: await fn((m, p, b, q) => api.call(m, p, b, q)) };
    } catch (e) {
      if (e instanceof ConnectionChanged && attempt === 0) continue; // a sync rotated the tokens just now: read them again once
      if (e instanceof NotionError) {
        if (e.invalidGrant || e.status === 401) return { ok: false, reason: "expired" };
        if (e.status === 403) return { ok: false, reason: "needs_write" };
        if (e.status === 404) return { ok: false, reason: "not_found" };
      }
      console.error("notion: write failed", describeError(e));
      return { ok: false, reason: "failed" };
    }
  }
  return { ok: false, reason: "failed" };
}
