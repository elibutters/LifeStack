// To-do list: validation, ordering, status handling, and the bearer-protected API.
// Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) {
  console.error("refusing to run: not the test database");
  process.exit(2);
}
const core = await import("../lib/todos-core.ts");
const t = await import("../lib/todos.ts");
const tok = await import("../lib/tokens.ts");
const { db } = await import("../lib/db.ts");
const { todos, apiTokens } = await import("@lifestack/db");

// ---- validation
assert.equal(core.TodoInput.safeParse({ title: "  Buy milk " }).data?.title, "Buy milk");
assert.equal(core.TodoInput.safeParse({ title: "" }).success, false);
assert.equal(core.TodoInput.safeParse({ title: "x", due: "2026-02-30" }).success, false);
assert.equal(core.TodoInput.safeParse({ title: "x", due: "tomorrow" }).success, false);
assert.equal(core.TodoInput.safeParse({ title: "x", due: "" }).data?.due, null);
assert.equal(core.TodoInput.safeParse({ title: "x", due: "2026-11-02" }).data?.due, "2026-11-02");
assert.equal(core.TodoPatch.safeParse({}).success, false);
assert.equal(core.TodoPatch.safeParse({ status: "later" }).success, false);
assert.equal(core.TodoPatch.safeParse({ status: "done" }).success, true);

// ---- pure helpers
const base = { createdAt: "2026-10-01T00:00:00Z" };
const sorted = core.sortTodos([
  { id: 1, status: "done" as const, due: null, ...base },
  { id: 2, status: "open" as const, due: null, ...base },
  { id: 3, status: "open" as const, due: "2026-11-05", ...base },
  { id: 4, status: "open" as const, due: "2026-11-01", ...base },
]);
assert.deepEqual(sorted.map((x) => x.id), [4, 3, 2, 1]);
assert.deepEqual(core.summarize(sorted, "2026-11-02"), { open: 3, overdue: 1, done: 1 });

// ---- storage
await db().delete(todos);
const a = await t.addTodo({ title: "First", note: "n", due: "2026-12-01" }, "agent");
const b = await t.addTodo({ title: "Second" });
assert.ok(a.ok && b.ok);
assert.equal((await t.addTodo({ title: "" })).ok, false);
const aId = (a as { id: number }).id, bId = (b as { id: number }).id;
let list = await t.listTodos();
assert.deepEqual(list.map((x) => x.id), [aId, bId]);
assert.equal(list[0]!.source, "agent");
assert.equal(list[1]!.source, "web");

await t.updateTodo(aId, { status: "done" });
list = await t.listTodos();
assert.deepEqual(list.map((x) => x.id), [bId, aId]);
assert.ok(list[1]!.completedAt);
await t.updateTodo(aId, { status: "open" });
list = await t.listTodos();
assert.equal(list.find((x) => x.id === aId)!.completedAt, null);
await t.updateTodo(aId, { note: "", due: "" });
const cleared = (await t.listTodos()).find((x) => x.id === aId)!;
assert.equal(cleared.note, null);
assert.equal(cleared.due, null);
assert.equal(((await t.updateTodo(999999, { status: "done" })) as { found: boolean }).found, false);
assert.equal((await t.updateTodo(aId, {})).ok, false);

// ---- API
const req = (method: string, key: string | null, body?: unknown) =>
  new Request("http://localhost/api/v1/todos", { method, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const writer = await tok.createToken("w", "agent", ["log:write", "log:read"]);
const reader = await tok.createToken("r", "agent", ["log:read"]);
assert.equal((await t.handleTodos(req("GET", null))).status, 401);
assert.equal((await t.handleTodos(req("POST", reader.token, { title: "x" }))).status, 403);
assert.equal((await t.handleTodos(req("POST", writer.token, { title: "" }))).status, 400);
const made = await t.handleTodos(req("POST", writer.token, { title: "From agent", due: "2026-11-09" }));
assert.equal(made.status, 201);
const id = ((await made.json()) as { id: number }).id;
const got = (await (await t.handleTodos(req("GET", reader.token))).json()) as { todos: { id: number; source: string }[] };
assert.equal(got.todos.find((x) => x.id === id)!.source, "agent");
assert.equal((await t.handleTodo(req("PATCH", reader.token, { status: "done" }), String(id))).status, 403);
assert.equal((await t.handleTodo(req("PATCH", writer.token, { status: "done" }), String(id))).status, 200);
assert.equal((await t.handleTodo(req("PATCH", writer.token, { status: "nope" }), String(id))).status, 400);
assert.equal((await t.handleTodo(req("PATCH", writer.token, { status: "done" }), "999999")).status, 404);
assert.equal((await t.handleTodo(req("PATCH", writer.token, { status: "done" }), "abc")).status, 404);
assert.equal((await t.handleTodo(req("DELETE", writer.token), String(id))).status, 200);
assert.equal((await t.handleTodo(req("DELETE", writer.token), String(id))).status, 404);

await db().delete(todos);
await db().delete(apiTokens);
console.log("todos: ok");
process.exit(0);
