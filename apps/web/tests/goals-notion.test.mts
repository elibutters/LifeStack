// Goal notebooks in Notion: the page that is built, finding the Goals page, what happens when Notion is not ready, and the log lines.
// Notion is mocked with synthetic data; nothing leaves the machine. Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
Object.assign(process.env, { NOTION_CLIENT_ID: "cid", NOTION_CLIENT_SECRET: "csecret", ENCRYPTION_KEY: "ab".repeat(32), APP_URL: "https://app.example", APP_TZ: "America/New_York" });
const core = await import("../lib/goals-notion-core.ts");
const gn = await import("../lib/goals-notion.ts");
const g = await import("../lib/goals.ts");
const store = await import("../lib/settings-store.ts");
const { encrypt, decrypt } = await import("../lib/crypto.ts");
const { db } = await import("../lib/db.ts");
const { events, connections, notes, settings, syncState } = await import("@lifestack/db");

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ---- the builders
const goal = { title: "Interview prep", thesis: "Be ready to talk through any case.", kind: "prep", targetDay: "2026-11-09", mode: "ask" };
const blocks = core.notebookBlocks(goal) as any[];
assert.deepEqual(blocks.map((b) => b.type), ["heading_2", "paragraph", "paragraph", "heading_2", "paragraph", "heading_2"], "Thesis, details, Brainstorm, Log: the Log heading is last so new lines land under it");
assert.deepEqual([blocks[0].heading_2.rich_text[0].text.content, blocks[3].heading_2.rich_text[0].text.content, blocks[5].heading_2.rich_text[0].text.content], ["Thesis", "Brainstorm", "Log"]);
assert.equal(blocks[1].paragraph.rich_text[0].text.content, goal.thesis); assert.match(blocks[2].paragraph.rich_text[0].text.content, /prep .* by 2026-11-09 .* ask/);
assert.match((core.notebookBlocks({ ...goal, thesis: "" }) as any[])[1].paragraph.rich_text[0].text.content, /Add it here/, "an empty thesis gets a prompt");
const long = (core.notebookBlocks({ ...goal, thesis: "x".repeat(5000) }) as any[])[1].paragraph.rich_text;
assert.equal(long.length, 3); assert.ok(long.every((r: any) => r.text.content.length <= 2000), "Notion's 2,000 character limit is respected"); assert.equal(long.map((r: any) => r.text.content).join("").length, 5000);
const lines = Array.from({ length: 15 }, (_, i) => `line ${i}`);
const plan = core.planBlocks("Oct 26", lines) as any[];
assert.equal(plan.length, 1 + 12 + 1); assert.match(plan[0].bulleted_list_item.rich_text[0].text.content, /Oct 26: plan committed, 15 sessions/); assert.match(plan.at(-1).bulleted_list_item.rich_text[0].text.content, /and 3 more/);
assert.match((core.planBlocks("Oct 26", ["a"]) as any[])[0].bulleted_list_item.rich_text[0].text.content, /1 session$/);
assert.equal((core.logBlocks("Oct 26", "Done: x") as any[])[0].bulleted_list_item.rich_text[0].text.content, "Oct 26: Done: x");
assert.equal(core.notebookUrl("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), "https://www.notion.so/aaaaaaaabbbbccccddddeeeeeeeeeeee");
assert.equal(core.pageTitleOf("  "), "Untitled goal"); assert.equal(core.pageTitleOf("y".repeat(300)).length, 200);

// ---- the log lines
const s = { goalId: "g1", title: "Interview prep", start: "2026-10-27T23:00:00.000Z", minutes: 60 };
const text = (e: any) => gn.describeEvent(e, new Date("2026-10-27T15:00:00Z")).blocks.map((b: any) => b.bulleted_list_item.rich_text[0].text.content);
assert.deepEqual(text({ type: "done", session: { ...s, minutesSpent: 70, rating: 4 }, note: "Covered cases 1 to 3" }), ["Oct 27: Done: Interview prep (70 min), rated 4/5. Covered cases 1 to 3"]);
assert.deepEqual(text({ type: "done", session: s }), ["Oct 27: Done: Interview prep"]);
assert.deepEqual(text({ type: "skipped", session: s }), ["Oct 27: Skipped: Interview prep (was Tue, Oct 27, 7:00 PM)"], "times are in the owner's time zone");
assert.deepEqual(text({ type: "moved", session: { ...s, start: "2026-10-28T23:30:00.000Z", movedFrom: ["2026-10-27T23:00:00.000Z"] } }), ["Oct 27: Moved: Interview prep from Tue, Oct 27, 7:00 PM to Wed, Oct 28, 7:30 PM"]);
const committed = text({ type: "committed", goalId: "g1", sessions: [s, { ...s, title: "Second", start: "2026-10-29T23:00:00.000Z" }] });
assert.deepEqual([committed[0], committed.length], ["Oct 27: plan committed, 2 sessions", 3]);

// ---- mock Notion
type Call = { method: string; path: string; auth: string | null; version: string | null; body: any };
const calls: Call[] = []; let access = "at-0", refresh = "rt-0", rotation = 0; let writeAllowed = true; let nextPageId = u(900); let pageStatus = 200;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url; const u2 = new URL(url); const headers = new Headers(init.headers ?? {});
  const body = init.body ? JSON.parse(String(init.body)) : undefined; const method = init.method ?? "GET";
  calls.push({ method, path: u2.pathname, auth: headers.get("authorization"), version: headers.get("notion-version"), body });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  if (u2.pathname === "/v1/oauth/token") {
    if (body.refresh_token !== refresh) return json({ error: "invalid_grant" }, 400);
    rotation++; access = `at-${rotation}`; refresh = `rt-${rotation}`; return json({ access_token: access, refresh_token: refresh });
  }
  if (headers.get("authorization") !== `Bearer ${access}`) return json({ object: "error", code: "unauthorized" }, 401);
  if (!writeAllowed) return json({ object: "error", code: "restricted_resource" }, 403);
  if (pageStatus !== 200) return json({ object: "error", code: "object_not_found" }, pageStatus);
  if (method === "POST" && u2.pathname === "/v1/pages") return json({ object: "page", id: nextPageId });
  if (method === "PATCH" && /^\/v1\/blocks\/[^/]+\/children$/.test(u2.pathname)) return json({ object: "list", results: [] });
  return json({ object: "error", message: "unexpected" }, 500);
}) as typeof fetch;
const writes = () => calls.filter((c) => c.path !== "/v1/oauth/token");
const wipe = async () => { await db().delete(events); await db().delete(connections); await db().delete(notes); await db().delete(settings); await db().delete(syncState); calls.length = 0; access = "at-0"; refresh = "rt-0"; rotation = 0; writeAllowed = true; pageStatus = 200; nextPageId = u(900); };
const connect = () => db().insert(connections).values({ provider: "notion", account: "Synthetic Space", refreshTokenEnc: encrypt(JSON.stringify({ access: "at-0", refresh: "rt-0" })) });
const goalsPage = (id: string, parent: string | null = null) => db().insert(notes).values({ sourceId: `page:${id}`, title: "Goals", bodyText: "", generation: 1, parentId: parent });
const mk = async (extra: object = {}) => ((await g.createGoal({ title: "Interview prep", thesis: "Be ready.", kind: "prep", targetDay: "2026-11-09", ...extra })) as any).goal;

// ---- finding the Goals page
await wipe(); await connect();
assert.equal(await gn.findGoalsParent(), null, "nothing shared yet");
await goalsPage(u(5), `page:${u(1)}`); await goalsPage(u(4));
assert.equal(await gn.findGoalsParent(), u(4), "the top-level page called Goals wins over a nested one");
await store.putSetting("goals.notionParent", u(7)); assert.equal(await gn.findGoalsParent(), u(7), "the preference overrides");
await store.deleteSetting("goals.notionParent");

// ---- creating a notebook
await wipe(); await connect(); let gl = await mk();
let r = await gn.ensureNotebook(gl.id);
assert.equal(r.state, "no_parent"); assert.match(r.help!, /page titled "Goals"/); assert.equal(writes().length, 0, "nothing is sent without somewhere to put it");
await goalsPage(u(4));
r = await gn.ensureNotebook(gl.id);
assert.deepEqual([r.state, r.url], ["ok", core.notebookUrl(u(900))]);
const create = writes()[0]!;
assert.deepEqual([create.method, create.path, create.auth, create.version], ["POST", "/v1/pages", "Bearer at-0", "2026-03-11"]);
assert.deepEqual(create.body.parent, { type: "page_id", page_id: u(4) }); assert.equal(create.body.properties.title.title[0].text.content, "Interview prep"); assert.equal(create.body.children.length, 6);
assert.equal(((await g.getGoal(gl.id)) as any).goal.notionPageId, u(900), "the notebook is remembered on the goal"); assert.equal(((await g.getGoal(gl.id)) as any).notebook, core.notebookUrl(u(900)));
calls.length = 0; r = await gn.ensureNotebook(gl.id);
assert.deepEqual([r.state, calls.length], ["exists", 0], "asking again does not make a second notebook");
assert.equal((await gn.ensureNotebook("gnope")).state, "failed");

// ---- Notion is not ready
await wipe(); await connect(); await goalsPage(u(4)); gl = await mk(); writeAllowed = false;
r = await gn.ensureNotebook(gl.id);
assert.equal(r.state, "needs_write"); assert.match(r.help!, /Insert content and Update content/); assert.equal(((await g.getGoal(gl.id)) as any).goal.notionPageId, null, "nothing is remembered when it failed");
writeAllowed = true; pageStatus = 404; assert.equal((await gn.ensureNotebook(gl.id)).state, "not_found"); pageStatus = 200;
await db().delete(connections); assert.equal((await gn.ensureNotebook(gl.id)).state, "not_connected");
await connect(); await db().update(connections).set({ refreshTokenEnc: encrypt("not json") }); assert.equal((await gn.ensureNotebook(gl.id)).state, "expired", "damaged stored tokens mean reconnecting, and are reported rather than thrown");
await db().update(connections).set({ refreshTokenEnc: encrypt(JSON.stringify({ access: "at-0", refresh: "rt-0" })) });
// an expired access token is refreshed once and the write goes through
calls.length = 0; access = "at-server-new"; r = await gn.ensureNotebook(gl.id);
assert.equal(r.state, "ok"); assert.ok(calls.some((c) => c.path === "/v1/oauth/token"), "refreshed");
assert.deepEqual(JSON.parse(decrypt((await db().select().from(connections))[0]!.refreshTokenEnc)), { access: "at-1", refresh: "rt-1" }, "the new pair is stored");

// ---- the log
await wipe(); await connect(); await goalsPage(u(4)); gl = await mk();
assert.equal(await gn.appendToNotebook(gl.id, core.logBlocks("Oct 27", "x") as any), "no_notebook", "no notebook yet: nothing sent");
assert.equal((await gn.notebookHook({ type: "done", session: { ...s, goalId: gl.id } })), "no_notebook");
await gn.ensureNotebook(gl.id); calls.length = 0;
assert.equal(await gn.notebookHook({ type: "done", session: { ...s, goalId: gl.id, minutesSpent: 45 }, note: "Covered it" }), "ok");
const patch = writes()[0]!; assert.deepEqual([patch.method, patch.path], ["PATCH", `/v1/blocks/${u(900)}/children`]);
assert.match(patch.body.children[0].bulleted_list_item.rich_text[0].text.content, /Done: Interview prep \(45 min\)\. Covered it/);
writeAllowed = false; assert.equal(await gn.notebookHook({ type: "skipped", session: { ...s, goalId: gl.id } }), "needs_write", "a refused write is reported, never thrown");
writeAllowed = true;

// ---- the session API calls the hook only when the action worked
const { handleSessionAction } = g;
const tok = await import("../lib/tokens.ts"); const w = await tok.createToken("w", "agent", ["goals:write"]);
const seen: any[] = [];
const sess = await g.commitPlan(gl.id, { sessions: [{ title: "Prep", start: new Date(Date.now() + 86_400_000).toISOString(), end: new Date(Date.now() + 90_000_000).toISOString() }] }, new Date()) as any;
const sid = sess.sessions[0].id;
const post = (id: string, body: unknown) => handleSessionAction(new Request("http://x/api/v1/goals/sessions/" + id, { method: "POST", headers: { authorization: `Bearer ${w.token}`, "content-type": "application/json" }, body: JSON.stringify(body) }), id, (e) => seen.push(e));
assert.equal((await post(sid, { action: "done", minutes: 50, note: "Cases 1 to 3" })).status, 200);
assert.deepEqual([seen[0].action, seen[0].session.id, seen[0].note, seen[0].session.minutesSpent], ["done", sid, "Cases 1 to 3", 50]);
assert.equal((await post(sid, { action: "move" })).status, 409); assert.equal(seen.length, 1, "a refused action is not logged");
assert.equal((await post(sid, { action: "nope" })).status, 400); assert.equal(seen.length, 1);

await wipe();
console.log("goals-notion: ok");
process.exit(0);
