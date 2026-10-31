// Agents adding to Notion pages: text to blocks, the two write paths, and what is reported when Notion is not ready.
// Notion is mocked; nothing leaves the machine. Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
Object.assign(process.env, { NOTION_CLIENT_ID: "cid", NOTION_CLIENT_SECRET: "csecret", ENCRYPTION_KEY: "ab".repeat(32), APP_URL: "https://app.example" });
const core = await import("../lib/notion-core.ts");
const w = await import("../lib/notes-write.ts");
const cap = await import("../lib/capture-core.ts");
const { encrypt } = await import("../lib/crypto.ts");
const { db } = await import("../lib/db.ts");
const { connections, notes } = await import("@lifestack/db");

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ---- text to blocks
const b = core.textToBlocks("# Title\n\nplain line\n- one\n* two\n### Small") as any[];
assert.deepEqual(b.map((x) => x.type), ["heading_1", "paragraph", "bulleted_list_item", "bulleted_list_item", "heading_3"]);
assert.equal(b[0].heading_1.rich_text[0].text.content, "Title");
assert.equal(core.textToBlocks("   \n \n"), null, "empty text is refused");
assert.equal(core.textToBlocks("x".repeat(core.WRITE_MAX_CHARS + 1)), null);
assert.equal(core.textToBlocks(Array.from({ length: core.WRITE_MAX_BLOCKS + 1 }, () => "a").join("\n")), null, "too many lines");
const long = (core.textToBlocks("y".repeat(5000)) as any[])[0].paragraph.rich_text;
assert.equal(long.length, 3); assert.ok(long.every((r: any) => r.text.content.length <= 2000), "Notion's 2,000 character limit is respected");

// ---- scope
assert.ok(cap.SCOPES.includes("notes:write") && cap.AGENT_SCOPES.includes("notes:write") && !cap.APP_SCOPES.includes("notes:write"), "notes:write is for agent keys, never the phone key");

// ---- mocked Notion
type Call = { method: string; path: string; body: any };
const calls: Call[] = []; let status = 200;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(String(input)); const body = init.body ? JSON.parse(init.body) : undefined;
  calls.push({ method: init.method ?? "GET", path: url.pathname, body });
  if (status !== 200) return new Response(JSON.stringify({ object: "error" }), { status });
  return new Response(JSON.stringify({ object: "page", id: u(900) }), { status: 200, headers: { "content-type": "application/json" } });
}) as any;
const connect = () => db().insert(connections).values({ provider: "notion", account: "Synthetic Space", refreshTokenEnc: encrypt(JSON.stringify({ access: "at-0", refresh: "rt-0" })) });
await db().delete(connections); await db().delete(notes);
const [note] = await db().insert(notes).values({ sourceId: `page:${u(1)}`, title: "Plans", bodyText: "", generation: 1 }).returning({ id: notes.id });
const id = note!.id;

assert.equal((await w.appendToNote(id, "hello")).state, "not_connected");
await connect();
assert.equal((await w.appendToNote(id, "")).state, "invalid");
assert.equal((await w.appendToNote(999999, "hello")).state, "no_such_note");
assert.equal(calls.length, 0, "nothing is sent for a bad request");

let r = await w.appendToNote(id, "## Idea\n- try it");
assert.equal(r.state, "ok"); assert.equal(r.url, `https://www.notion.so/${u(1).replace(/-/g, "")}`);
assert.deepEqual([calls[0]!.method, calls[0]!.path], ["PATCH", `/v1/blocks/${u(1)}/children`]);
assert.deepEqual(calls[0]!.body.children.map((x: any) => x.type), ["heading_2", "bulleted_list_item"]);

calls.length = 0;
r = await w.addNotePage(id, "  New page ", "first line");
assert.equal(r.state, "ok"); assert.equal(r.url, `https://www.notion.so/${u(900).replace(/-/g, "")}`);
assert.deepEqual([calls[0]!.method, calls[0]!.path], ["POST", "/v1/pages"]);
assert.deepEqual(calls[0]!.body.parent, { type: "page_id", page_id: u(1) });
assert.equal(calls[0]!.body.properties.title.title[0].text.content, "New page");
assert.equal((await w.addNotePage(id, " ", "x")).state, "invalid");
assert.equal((await w.addNotePage(999999, "t", "x")).state, "no_such_note");

// ---- Notion not ready
status = 403; r = await w.appendToNote(id, "x"); assert.equal(r.state, "needs_write"); assert.match(r.help!, /Insert content and Update content/);
status = 404; assert.equal((await w.appendToNote(id, "x")).state, "not_found");
status = 500; assert.equal((await w.addNotePage(id, "t", "x")).state, "failed");

await db().delete(connections); await db().delete(notes);
console.log("notes-write: ok");
process.exit(0);
