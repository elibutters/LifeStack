import "server-only";
import { desc, eq } from "drizzle-orm";
import { todos } from "@lifestack/db";
import { db } from "./db";
import { describeError } from "./errors";
import { verifyBearer } from "./tokens";
import { sortTodos, TodoInput, TodoPatch, type Todo, type TodoSource, type TodoStatus } from "./todos-core";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const MAX_BODY = 4096;

type Issues = { path: string; message: string }[];
type Fail = { ok: false; issues: Issues };
const issuesOf = (e: { issues: { path: PropertyKey[]; message: string }[] }): Issues => e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));

const shape = (r: typeof todos.$inferSelect): Todo => ({
  id: r.id,
  title: r.title,
  note: r.note,
  status: r.status as TodoStatus,
  due: r.due,
  source: r.source as TodoSource,
  createdAt: r.createdAt.toISOString(),
  completedAt: r.completedAt?.toISOString() ?? null,
});

export async function listTodos(): Promise<Todo[]> {
  const rows = await db().select().from(todos).orderBy(desc(todos.createdAt)).limit(500);
  return sortTodos(rows.map(shape));
}

export async function addTodo(input: unknown, source: TodoSource = "web"): Promise<{ ok: true; id: number } | Fail> {
  const p = TodoInput.safeParse(input);
  if (!p.success) return { ok: false, issues: issuesOf(p.error) };
  const [row] = await db().insert(todos).values({ title: p.data.title, note: p.data.note ?? null, due: p.data.due ?? null, source }).returning({ id: todos.id });
  return { ok: true, id: row!.id };
}

export async function updateTodo(id: number, input: unknown): Promise<{ ok: true; found: boolean } | Fail> {
  const p = TodoPatch.safeParse(input);
  if (!p.success) return { ok: false, issues: issuesOf(p.error) };
  const now = new Date();
  const set = { ...p.data, updatedAt: now, ...(p.data.status ? { completedAt: p.data.status === "done" ? now : null } : {}) };
  const rows = await db().update(todos).set(set).where(eq(todos.id, id)).returning({ id: todos.id });
  return { ok: true, found: rows.length > 0 };
}

export async function deleteTodo(id: number): Promise<boolean> {
  return (await db().delete(todos).where(eq(todos.id, id)).returning({ id: todos.id })).length > 0;
}

async function readBody(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  const text = await req.text();
  if (text.length > MAX_BODY) return { ok: false, res: json({ error: "too_large" }, 413) };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, res: json({ error: "invalid_json" }, 400) };
  }
}

const invalid = (issues: Issues) => json({ error: "invalid", issues }, 400);
const notFound = () => json({ error: "not_found" }, 404);
const idOf = (raw: string) => (/^\d{1,15}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null);

async function handle(req: Request, scope: "log:read" | "log:write", rawId: string | null, fn: (id: number | null, body: unknown, kind: string) => Promise<Response>): Promise<Response> {
  const auth = await verifyBearer(req.headers.get("authorization"), scope);
  if (!auth.ok) return json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, auth.status);
  const id = rawId === null ? null : idOf(rawId);
  if (rawId !== null && id === null) return notFound();
  try {
    let body: unknown;
    if (req.method !== "GET" && req.method !== "DELETE") {
      const b = await readBody(req);
      if (!b.ok) return b.res;
      body = b.body;
    }
    return await fn(id, body, auth.token.kind);
  } catch (e) {
    console.error("todos: failed", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}

// GET (list) and POST (add) /api/v1/todos. POST takes title, note and due (YYYY-MM-DD).
export const handleTodos = (req: Request) =>
  handle(req, req.method === "POST" ? "log:write" : "log:read", null, async (_id, body, kind) => {
    if (req.method !== "POST") return json({ todos: await listTodos() });
    const r = await addTodo(body, kind === "app" ? "app" : "agent");
    return r.ok ? json({ id: r.id }, 201) : invalid(r.issues);
  });

// PATCH and DELETE /api/v1/todos/{id}
export const handleTodo = (req: Request, rawId: string) =>
  handle(req, "log:write", rawId, async (id, body) => {
    if (req.method === "DELETE") return (await deleteTodo(id!)) ? json({ ok: true }) : notFound();
    const r = await updateTodo(id!, body);
    return !r.ok ? invalid(r.issues) : r.found ? json({ ok: true }) : notFound();
  });
