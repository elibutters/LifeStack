// Notion: mapping, OAuth, token rotation, the resumable walk (partial vs finished, trash, depth, caps, lease, 429) and notes:read.
// Notion is faked with synthetic pages; nothing leaves the machine. Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
Object.assign(process.env, { NOTION_CLIENT_ID: "cid", NOTION_CLIENT_SECRET: "csecret", ENCRYPTION_KEY: "ab".repeat(32), APP_URL: "https://app.example", APP_TZ: "UTC" });
const core = await import("../lib/notion-core.ts");
const nt = await import("../lib/notion.ts");
const sync = await import("../lib/notion-sync.ts");
const rd = await import("../lib/notes.ts");
const tok = await import("../lib/tokens.ts");
const cap = await import("../lib/capture-core.ts");
const { encrypt, decrypt } = await import("../lib/crypto.ts");
const { db } = await import("../lib/db.ts");
const { notes, connections, syncState, apiTokens } = await import("@lifestack/db");
const { eq } = await import("drizzle-orm");

// ---------------------------------------------------------------- synthetic workspace
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rt = (t: string) => [{ plain_text: t }];
const blk = (id: string, type: string, extra: Record<string, unknown> = {}, has = false) => ({ id, type, has_children: has, last_edited_time: "2026-10-02T10:00:00.000Z", ...extra });
const para = (id: string, t: string) => blk(id, "paragraph", { paragraph: { rich_text: rt(t) } });
const rich = (type: string, id: string, t: string, extra: Record<string, unknown> = {}) => blk(id, type, { [type]: { rich_text: rt(t), ...extra } });
const childPage = (id: string, title: string) => blk(id, "child_page", { child_page: { title } });

type Pg = { id: string; title: string; trashed?: boolean; parent?: unknown };
const pages = new Map<string, Pg>(); const kids = new Map<string, unknown[]>();
let searchPages: string[] = []; let searchDs: string[] = []; const dsRows = new Map<string, string[]>(); const dbSources = new Map<string, string[]>();
function build() {
  pages.clear(); kids.clear(); dsRows.clear(); dbSources.clear();
  const add = (id: string, title: string, blocks: unknown[], extra: Partial<Pg> = {}) => { pages.set(id, { id, title, ...extra }); kids.set(id, blocks); };
  add(u(1), "Project Alpha", [
    rich("heading_1", u(201), "Plan"), para(u(202), "First paragraph"), rich("bulleted_list_item", u(203), "milk"), rich("bulleted_list_item", u(204), "eggs"),
    rich("numbered_list_item", u(205), "one"), rich("numbered_list_item", u(206), "two"), rich("to_do", u(207), "call", { checked: false }), rich("to_do", u(208), "email", { checked: true }),
    rich("quote", u(209), "wise words"), rich("callout", u(210), "heads up"), rich("code", u(211), "let x = 1"),
    blk(u(100), "toggle", { toggle: { rich_text: rt("More") } }, true),
    blk(u(212), "image", { image: { type: "file", file: { url: "https://files.example/secret.png" } } }), blk(u(213), "file", { file: { type: "file", file: { url: "https://files.example/doc.pdf" } } }),
    childPage(u(2), "Child B"), blk(u(50), "child_database", { child_database: { title: "Tasks" } }),
  ]);
  kids.set(u(100), [para(u(214), "inside toggle"), childPage(u(3), "Hidden in toggle")]);
  add(u(2), "Child B", [para(u(215), "bee")], { parent: { type: "page_id", page_id: u(1) } });
  add(u(3), "Hidden in toggle", [para(u(216), "found via container")]);
  for (let n = 0; n <= 7; n++) add(u(10 + n), `Level ${n}`, [para(u(300 + n), `level ${n}`), ...(n < 7 ? [childPage(u(11 + n), `Level ${n + 1}`)] : [])]);
  add(u(20), "Big", [para(u(217), "x".repeat(7000))]);
  add(u(21), "Gone", [para(u(218), "gone")], { trashed: true });
  add(u(30), "Row one", [para(u(219), "row body")], { parent: { type: "data_source_id", data_source_id: u(60), database_id: u(50) } });
  add(u(31), "Row two", [para(u(220), "row two")], { trashed: true });
  dbSources.set(u(50), [u(60)]); dsRows.set(u(60), [u(30), u(31)]);
  searchPages = [u(1), u(10), u(20), u(21)]; searchDs = [u(60)];
}

// ---------------------------------------------------------------- mock Notion
type Call = { method: string; path: string; auth: string | null; headers: Headers; body: string };
const calls: Call[] = [];
let access = "at-0", refresh = "rt-0", refreshCount = 0, rotation = 0;
let refreshMode: "ok" | "invalid" = "ok"; let alwaysUnauthorized = false; let onRefresh: (() => Promise<void>) | null = null;
let rateLimit: { remaining: number; retryAfter: string } | null = null; const SEARCH_PAGE = 2;
const pageObj = (p: Pg) => ({ object: "page", id: p.id, in_trash: !!p.trashed, url: `https://www.notion.so/${p.id.replace(/-/g, "")}`, last_edited_time: "2026-10-01T10:00:00.000Z", parent: p.parent ?? { type: "workspace", workspace: true }, properties: { Name: { type: "title", title: rt(p.title) } } });
const paged = (all: unknown[], cursor: string | null, size: number) => { const off = Number(cursor ?? 0); const part = all.slice(off, off + size); return { results: part, has_more: off + size < all.length, next_cursor: off + size < all.length ? String(off + size) : null }; };
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url; const u2 = new URL(url);
  const headers = new Headers(init.headers ?? {}); const body = String(init.body ?? "");
  calls.push({ method: init.method ?? "GET", path: u2.pathname, auth: headers.get("authorization"), headers, body });
  const json = (b: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: h });
  if (u2.pathname === "/v1/oauth/token") {
    const b = JSON.parse(body);
    if (b.grant_type === "refresh_token") {
      if (refreshMode === "invalid" || b.refresh_token !== refresh) return json({ error: "invalid_grant" }, 400);
      refreshCount++; if (onRefresh) await onRefresh();
      rotation++; access = `at-${rotation}`; refresh = `rt-${rotation}`;
    }
    return json({ access_token: access, refresh_token: refresh, workspace_name: "Synthetic Space" });
  }
  if (alwaysUnauthorized || headers.get("authorization") !== `Bearer ${access}`) return json({ object: "error", code: "unauthorized" }, 401);
  if (rateLimit && rateLimit.remaining > 0) { rateLimit.remaining--; return json({ object: "error", code: "rate_limited" }, 429, { "retry-after": rateLimit.retryAfter }); }
  const parts = u2.pathname.split("/");
  if (u2.pathname === "/v1/search") {
    const b = JSON.parse(body); const want = b.filter?.value;
    const all = want === "data_source" ? searchDs.map((id) => ({ object: "data_source", id, in_trash: false, title: rt("Tasks") })) : searchPages.map((id) => pageObj(pages.get(id)!));
    return json({ object: "list", ...paged(all, b.start_cursor ?? null, SEARCH_PAGE) });
  }
  if (parts[2] === "pages" && parts[3]) { const p = pages.get(parts[3]); return p ? json(pageObj(p)) : json({ object: "error" }, 404); }
  if (parts[2] === "blocks" && parts[4] === "children") return json({ object: "list", ...paged(kids.get(parts[3]!) ?? [], u2.searchParams.get("start_cursor"), 100) });
  if (parts[2] === "databases" && parts[3]) return json({ object: "database", id: parts[3], in_trash: false, data_sources: (dbSources.get(parts[3]) ?? []).map((id) => ({ id })) });
  if (parts[2] === "data_sources" && parts[4] === "query") { const b = JSON.parse(body); return json({ object: "list", ...paged((dsRows.get(parts[3]!) ?? []).map((id) => pageObj(pages.get(id)!)), b.start_cursor ?? null, SEARCH_PAGE) }); }
  return json({ object: "error", message: "unexpected " + url }, 500);
}) as typeof fetch;

const noSleep = { sleep: async () => {} };
const reset = async () => {
  await db().delete(notes); await db().delete(connections); await db().delete(syncState); await db().delete(apiTokens);
  build(); calls.length = 0; access = "at-0"; refresh = "rt-0"; refreshCount = 0; rotation = 0; refreshMode = "ok"; alwaysUnauthorized = false; onRefresh = null; rateLimit = null;
};
const connect = () => sync.saveConnection({ access: "at-0", refresh: "rt-0" }, "Synthetic Space");
const stored = async () => (await db().select().from(notes)).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
const byId = async (n: number) => (await db().select().from(notes).where(eq(notes.sourceId, `page:${u(n)}`)))[0];
const api = () => calls.filter((c) => c.path.startsWith("/v1/") && !c.path.startsWith("/v1/oauth"));

// ---------------------------------------------------------------- mapping and caps
assert.equal(core.pageTitle({ properties: { Name: { type: "title", title: rt("Hello ") } } }), "Hello");
assert.equal(core.pageTitle({ properties: { x: { type: "rich_text" } } }), "Untitled");
assert.equal(core.pageTitle(null), "Untitled");
assert.equal(core.dataSourceTitle({ title: rt("Tasks") }), "Tasks");
assert.equal(core.parentRef({ type: "page_id", page_id: "p1" }), "page:p1");
assert.equal(core.parentRef({ type: "data_source_id", data_source_id: "d1" }), "data_source:d1");
assert.equal(core.parentRef({ type: "workspace", workspace: true }), null);
assert.equal(core.isTrashed({ in_trash: true }), true); assert.equal(core.isTrashed({ in_trash: false }), false);
assert.equal(core.notionUrl("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), "https://www.notion.so/aaaaaaaabbbbccccddddeeeeeeeeeeee");
const text = core.blocksToText([
  rich("heading_1", "h", "Title"), para("p", "Body"), rich("bulleted_list_item", "b", "item"), rich("numbered_list_item", "n1", "first"), rich("numbered_list_item", "n2", "second"), para("gap", "after"),
  rich("numbered_list_item", "n3", "again"), rich("to_do", "t1", "open", { checked: false }), rich("to_do", "t2", "done", { checked: true }), rich("quote", "q", "said"), rich("callout", "c", "note"),
  rich("code", "k", "code()"), rich("toggle", "tg", "more"),
  blk("img", "image", { image: { type: "external", external: { url: "https://x.example/a.png" } } }), blk("vid", "video", { video: {} }), blk("pdf", "pdf", { pdf: {} }), blk("fl", "file", { file: {} }),
  blk("emb", "embed", { embed: { url: "https://x.example" } }), blk("bm", "bookmark", { bookmark: { url: "https://x.example" } }), blk("div", "divider", {}), childPage("cp", "A child"), para("empty", "   "),
  blk("row", "table_row", { table_row: { cells: [rt("a"), rt("b")] } }),
]);
assert.equal(text, "Title\nBody\n- item\n1. first\n2. second\nafter\n1. again\n[ ] open\n[x] done\n> said\nnote\ncode()\nmore\na | b");
assert.ok(!/example|https?:/.test(text), "no URLs from files, media or embeds");
assert.equal(core.capText("y".repeat(7000)).length, 6000);
assert.equal(core.noteRow(u(1), { title: "T".repeat(500), edited: "2026-10-01T00:00:00Z", parent: null }, "z".repeat(9000), 3).bodyText.length, 6000);
assert.equal(core.noteRow(u(1), { title: "T", edited: "garbage", parent: null }, "b", 1).editedAt, null);
assert.equal(core.noteRow(u(1), { title: "T", edited: null, parent: null }, "b", 1).url, core.notionUrl(u(1)));
const refs = core.childRefs([childPage(u(2), "Child B"), blk(u(50), "child_database", { child_database: { title: "Tasks" } }), para(u(9), "x"), childPage("not-a-uuid", "bad")]);
assert.deepEqual([refs.pages.map((p) => p.id), refs.databases.map((d) => d.id)], [[u(2)], [u(50)]]);
assert.deepEqual(core.containerIds([blk(u(100), "toggle", {}, true), blk(u(101), "toggle", {}, false), blk(u(102), "paragraph", {}, true), blk(u(103), "column_list", {}, true)]), [u(100), u(103)]);
assert.equal(core.snippetAround("a ".repeat(300) + "needle here", "NEEDLE", 60).includes("needle"), true);
assert.equal(core.snippetAround("short text", undefined), "short text");
assert.deepEqual(core.readCursor("not json"), { gen: 0, active: false, queue: [], count: 0 });
assert.deepEqual(core.readCursor(JSON.stringify({ gen: 2, active: true, queue: [{ k: "bad" }], count: 0 })), { gen: 0, active: false, queue: [], count: 0 }, "a damaged cursor starts over");
assert.equal(core.parseStored("{}"), null); assert.deepEqual(core.parseStored(JSON.stringify({ access: "a", refresh: "r" })), { access: "a", refresh: "r" });

// ---------------------------------------------------------------- OAuth
await reset();
const au = new URL(nt.authorizeUrl("https://app.example", "state1"));
assert.equal(au.origin + au.pathname, "https://api.notion.com/v1/oauth/authorize");
assert.deepEqual([au.searchParams.get("client_id"), au.searchParams.get("response_type"), au.searchParams.get("owner"), au.searchParams.get("state"), au.searchParams.get("redirect_uri")], ["cid", "code", "user", "state1", "https://app.example/api/connections/notion/callback"]);
assert.equal(nt.notionConfigured(), true); delete process.env.NOTION_CLIENT_SECRET; assert.equal(nt.notionConfigured(), false); process.env.NOTION_CLIENT_SECRET = "csecret";
const ex = await nt.exchangeCode("https://app.example", "code-1");
assert.deepEqual([ex.access, ex.refresh, ex.workspace], ["at-0", "rt-0", "Synthetic Space"]);
const xc = calls.at(-1)!;
assert.equal(xc.auth, `Basic ${Buffer.from("cid:csecret").toString("base64")}`); assert.equal(xc.headers.get("notion-version"), "2026-03-11");
assert.deepEqual(JSON.parse(xc.body), { grant_type: "authorization_code", code: "code-1", redirect_uri: "https://app.example/api/connections/notion/callback" });
assert.equal(await sync.syncNotion(), null, "nothing to sync before connecting");
await connect();
const conn0 = (await db().select().from(connections))[0]!;
assert.ok(!conn0.refreshTokenEnc.includes("at-0") && !conn0.refreshTokenEnc.includes("rt-0"), "tokens are stored encrypted");
assert.deepEqual(JSON.parse(decrypt(conn0.refreshTokenEnc)), { access: "at-0", refresh: "rt-0" }); assert.equal(conn0.account, "Synthetic Space");

// ---------------------------------------------------------------- a full walk
let r = await sync.syncNotion(noSleep);
assert.deepEqual(r, { pages: 11, done: true });
const want = [u(1), u(2), u(3), ...[0, 1, 2, 3, 4, 5].map((n) => u(10 + n)), u(20), u(30)].map((x) => `page:${x}`).sort();
assert.deepEqual((await stored()).map((n) => n.sourceId), want, "shared pages, child pages, pages in toggles, rows and a chain to depth 5; no trash, no depth 6");
assert.equal(await byId(21), undefined, "a trashed page is not stored"); assert.equal(await byId(31), undefined, "a trashed database row is not stored"); assert.equal(await byId(16), undefined, "depth stops at 5");
const alpha = (await byId(1))!;
assert.equal(alpha.title, "Project Alpha"); assert.equal(alpha.url, `https://www.notion.so/${u(1).replace(/-/g, "")}`); assert.equal(alpha.generation, 1);
assert.ok(alpha.bodyText.includes("# ") === false && alpha.bodyText.startsWith("Plan\nFirst paragraph\n- milk\n- eggs\n1. one\n2. two\n[ ] call\n[x] email\n> wise words\nheads up\nlet x = 1\nMore\ninside toggle"), alpha.bodyText);
assert.ok(!/files\.example|secret\.png|doc\.pdf/.test(alpha.bodyText), "files and media are omitted");
assert.equal((await byId(20))!.bodyText.length, 6000, "bodies are capped at 6,000 characters");
assert.equal((await byId(2))!.parentId, `page:${u(1)}`); assert.equal((await byId(30))!.parentId, `data_source:${u(60)}`);
assert.equal((await byId(3))!.bodyText, "found via container", "a page inside a toggle is found by walking");
const st = await sync.getSyncState(); assert.ok(st!.lastOkAt && st!.lastError === null && st!.leaseUntil === null, "finished, no error, lease released");
assert.equal(readC(st!.cursor).active, false); function readC(c: string | null) { return core.readCursor(c); }
assert.ok(api().every((c) => c.auth === "Bearer at-0" && c.headers.get("notion-version") === "2026-03-11"), "the access token is reused and the version header is sent");
assert.equal(refreshCount, 0, "no refresh while the access token still works");
assert.ok(calls.every((c) => c.method === "GET" || c.method === "POST") && calls.every((c) => new URL(`https://api.notion.com${c.path}`).origin === "https://api.notion.com"), "reads only; nothing is written to Notion");
assert.ok(api().length <= 40, `one run stays within 40 requests (${api().length})`);

// ---------------------------------------------------------------- a partial walk deletes nothing; the finished one does
await reset(); await connect();
await db().insert(notes).values({ sourceId: `page:${u(99)}`, title: "Deleted in Notion", bodyText: "old", generation: 0 });
let runs = 0; calls.length = 0;
r = await sync.syncNotion({ ...noSleep, maxRequests: 3 }); runs++;
assert.deepEqual([r && "done" in r && r.done, (await byId(99))?.title], [false, "Deleted in Notion"], "a partial walk deletes nothing");
assert.equal(core.readCursor((await sync.getSyncState())!.cursor).active, true);
assert.ok(core.readCursor((await sync.getSyncState())!.cursor).queue.length > 0, "the queue is kept for the next run");
assert.ok(api().length <= 3, "the request budget is honoured");
let guard = 0; while (!(r && "done" in r && r.done) && guard++ < 60) { r = await sync.syncNotion({ ...noSleep, maxRequests: 3 }); runs++; }
assert.ok(runs > 3 && r && "done" in r && r.done, `the walk resumed across ${runs} runs`);
assert.equal(await byId(99), undefined, "a finished walk deletes pages that were not seen");
assert.deepEqual((await stored()).map((n) => n.sourceId), want); assert.ok((await stored()).every((n) => n.generation === 1), "every page is stamped with the generation");

// ---------------------------------------------------------------- the next walk gets a new generation, and drops what vanished
build(); kids.set(u(12), [para(u(302), "level 2")]); // the link from level 2 to level 3 is gone
r = await sync.syncNotion(noSleep); assert.ok(r && "done" in r && r.done);
assert.ok((await stored()).every((n) => n.generation === 2), "a new walk is a new generation");
assert.deepEqual((await stored()).map((n) => n.sourceId), want.filter((x) => ![13, 14, 15].some((n) => x === `page:${u(n)}`)), "pages no longer reachable are deleted when the walk finishes");

// ---------------------------------------------------------------- trash means delete, immediately
await reset(); await connect();
await db().insert(notes).values({ sourceId: `page:${u(21)}`, title: "Was fine yesterday", bodyText: "x", generation: 0 });
r = await sync.syncNotion({ ...noSleep, maxRequests: 2 }); // only the first search page
assert.equal(await byId(21), undefined, "a page Notion reports in the trash is removed straight away, even mid-walk");

// ---------------------------------------------------------------- the lease
await reset(); await connect();
await db().insert(syncState).values({ source: "notion", leaseUntil: new Date(Date.now() + 60_000) }).onConflictDoNothing();
await db().update(syncState).set({ leaseUntil: new Date(Date.now() + 60_000) }).where(eq(syncState.source, "notion"));
calls.length = 0; assert.deepEqual(await sync.syncNotion(noSleep), { skipped: true }); assert.equal(calls.length, 0, "a run holding the lease blocks another");
await db().update(syncState).set({ leaseUntil: new Date(Date.now() - 1000) }).where(eq(syncState.source, "notion"));
assert.ok((await sync.syncNotion(noSleep)) && true); assert.equal((await sync.getSyncState())!.leaseUntil, null, "the lease is released after a run");

// ---------------------------------------------------------------- tokens rotate, once, safely
await reset(); await connect();
access = "at-server-new"; // the stored access token is no longer valid
r = await sync.syncNotion(noSleep);
assert.ok(r && "done" in r && r.done, "a 401 triggers one refresh and the run carries on");
assert.equal(refreshCount, 1, "refreshed exactly once");
const conn1 = (await db().select().from(connections))[0]!;
assert.deepEqual(JSON.parse(decrypt(conn1.refreshTokenEnc)), { access: "at-1", refresh: "rt-1" }, "both new tokens are stored");
assert.ok(!conn1.refreshTokenEnc.includes("rt-1"), "still encrypted");
assert.ok(api().some((c) => c.auth === "Bearer at-1"), "calls after the refresh use the new access token");
const firstAt1 = calls.findIndex((c) => c.auth === "Bearer at-1"), refreshAt = calls.findIndex((c) => c.path === "/v1/oauth/token");
assert.ok(refreshAt >= 0 && refreshAt < firstAt1, "the new pair is saved before the next call uses it");

await reset(); await connect(); access = "at-server-new";
onRefresh = async () => { await db().update(connections).set({ refreshTokenEnc: encrypt(JSON.stringify({ access: "x", refresh: "y" })) }).where(eq(connections.provider, "notion")); };
assert.equal(await sync.syncNotion(noSleep), null, "if the connection changed during the refresh, the run abandons its work");
assert.equal((await stored()).length, 0, "and writes nothing");
assert.ok(api().filter((c) => c.auth === "Bearer at-1").length === 0, "the new token is never used after losing the swap");

await reset(); await connect(); access = "at-server-new"; refreshMode = "invalid";
r = await sync.syncNotion(noSleep);
assert.deepEqual(r, { expired: true }); assert.equal((await sync.getSyncState())!.lastError, sync.EXPIRED, "invalid_grant sets last_error and stops");
const before = calls.length; await sync.syncNotionIfStale(); assert.equal(calls.length, before, "an expired connection is not retried");
assert.deepEqual(JSON.parse(decrypt((await db().select().from(connections))[0]!.refreshTokenEnc)), { access: "at-0", refresh: "rt-0" }, "the stored tokens are untouched");

await reset(); await connect(); alwaysUnauthorized = true;
r = await sync.syncNotion(noSleep); assert.deepEqual(r, { expired: true }); assert.equal(refreshCount, 1, "a second 401 after refreshing is not refreshed again");

// ---------------------------------------------------------------- rate limits
await reset(); await connect(); rateLimit = { remaining: 1, retryAfter: "2" };
const slept: number[] = [];
r = await sync.syncNotion({ sleep: async (ms) => { slept.push(ms); } });
assert.deepEqual(slept, [2000], "Retry-After is honoured"); assert.ok(r && "done" in r && r.done, "and the run carries on");
await reset(); await connect(); rateLimit = { remaining: 1, retryAfter: "300" }; slept.length = 0;
r = await sync.syncNotion({ sleep: async (ms) => { slept.push(ms); } });
assert.deepEqual(slept, [], "a long wait is not slept through"); assert.ok(r && "done" in r && !r.done);
assert.match((await sync.getSyncState())!.lastError ?? "", /rate limit/i);
const c429 = core.readCursor((await sync.getSyncState())!.cursor); assert.ok(c429.active && c429.queue.length > 0, "the queue is kept so the next run resumes");

// ---------------------------------------------------------------- the page cap
await reset(); await connect();
r = await sync.syncNotion({ ...noSleep, maxPages: 3 });
assert.ok(r && "done" in r && r.done); assert.equal((await stored()).length, 3);
assert.match((await sync.getSyncState())!.lastError ?? "", /only the first 3 were copied/, "the cap is reported as an error");
assert.equal(core.MAX_PAGES, 2000);

// ---------------------------------------------------------------- staleness
await reset(); await connect();
await sync.syncNotion(noSleep); const afterFull = calls.length;
await sync.syncNotionIfStale(); assert.equal(calls.length, afterFull, "a fresh copy is not re-synced");
const oldIso = new Date(Date.now() - 20 * 60_000);
await db().update(syncState).set({ lastOkAt: oldIso, cursor: JSON.stringify({ ...core.readCursor((await sync.getSyncState())!.cursor), tried: new Date(Date.now() - 60_000).toISOString() }) }).where(eq(syncState.source, "notion"));
await sync.syncNotionIfStale(); assert.equal(calls.length, afterFull, "never more than once in two minutes, even when stale");
await db().update(syncState).set({ cursor: JSON.stringify({ ...core.readCursor((await sync.getSyncState())!.cursor), tried: new Date(Date.now() - 5 * 60_000).toISOString() }) }).where(eq(syncState.source, "notion"));
await sync.syncNotionIfStale(); assert.ok(calls.length > afterFull, "stale and past the retry window: it syncs");

// ---------------------------------------------------------------- reading: the API, search and MCP scope
const nav = await rd.searchNotes({ q: "milk" }); assert.deepEqual(nav.map((n) => n.title), ["Project Alpha"]); assert.ok(nav[0]!.snippet.includes("milk"));
assert.equal((await rd.searchNotes({ q: "%" })).length, 0, "wildcards are matched literally");
assert.ok((await rd.searchNotes({ q: "level 3" })).some((n) => n.title === "Level 3"), "title and body are both searched");
assert.ok((await rd.searchNotes({ limit: 3 })).length === 3);
const noteId = nav[0]!.id;
assert.equal((await rd.getNote(noteId))!.body.startsWith("Plan"), true); assert.equal(await rd.getNote(999999), null);
const req = (path: string, key: string | null) => new Request(`http://localhost/api/v1/notes${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
const reader = await tok.createToken("r", "agent", ["notes:read"]); const other = await tok.createToken("o", "agent", ["log:read"]); const app = await tok.createAppToken("test phone", null);
assert.equal((await rd.handleNotesSearch(req("", null))).status, 401);
assert.equal((await rd.handleNotesSearch(req("", other.token))).status, 403, "a key without notes:read is refused");
assert.equal((await rd.handleNotesSearch(req("", app.token))).status, 403, "the phone key has no notes:read by default");
const ok = await rd.handleNotesSearch(req("?q=milk", reader.token)); assert.equal(ok.status, 200); assert.equal(((await ok.json()) as { notes: unknown[] }).notes.length, 1);
assert.equal((await rd.handleNotesSearch(req("?limit=500", reader.token))).status, 400); assert.equal((await rd.handleNotesSearch(req("?limit=x", reader.token))).status, 400);
assert.equal((await rd.handleNoteOne(req("/1", other.token), String(noteId))).status, 403);
assert.equal((await rd.handleNoteOne(req("/1", reader.token), "abc")).status, 404); assert.equal((await rd.handleNoteOne(req("/1", reader.token), "999999")).status, 404);
const one = await rd.handleNoteOne(req("/1", reader.token), String(noteId)); assert.equal(one.status, 200); assert.equal(((await one.json()) as { title: string }).title, "Project Alpha");
assert.ok(cap.SCOPES.includes("notes:read") && cap.AGENT_SCOPES.includes("notes:read") && !cap.APP_SCOPES.includes("notes:read"), "notes:read is on agent keys, never on the phone key");
const legacy = await tok.createToken("old agent", "agent", ["log:read", "log:write", "calendar:read"]);
assert.equal((await rd.handleNotesSearch(req("", legacy.token))).status, 403, "existing agent keys keep their old scopes");

// ---------------------------------------------------------------- disconnect
await sync.disconnectNotion();
assert.deepEqual([(await db().select().from(connections)).length, (await db().select().from(syncState).where(eq(syncState.source, "notion"))).length, (await stored()).length], [0, 0, 0], "disconnecting deletes the connection, the sync row and the notes");

await reset();
console.log("notion: ok");
process.exit(0);
