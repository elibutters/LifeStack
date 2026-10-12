import "server-only";
import { desc, eq } from "drizzle-orm";
import { wants } from "@lifestack/db";
import { db } from "./db";
import { describeError } from "./errors";
import { verifyBearer } from "./tokens";
import { WantInput, WantPatch, type Want, type WantStatus } from "./wants-core";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const MAX_BODY = 4096;

const shape = (r: typeof wants.$inferSelect): Want => ({
  id: r.id,
  title: r.title,
  note: r.note,
  url: r.url,
  priceCents: r.priceCents,
  status: r.status as WantStatus,
  createdAt: r.createdAt.toISOString(),
});

export async function listWants(): Promise<Want[]> {
  const rows = await db().select().from(wants).orderBy(desc(wants.createdAt)).limit(500);
  return rows.map(shape);
}

export async function addWant(input: unknown): Promise<{ ok: true; want: Want } | { ok: false; issues: { path: string; message: string }[] }> {
  const p = WantInput.safeParse(input);
  if (!p.success) return { ok: false, issues: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  const [row] = await db()
    .insert(wants)
    .values({ title: p.data.title, note: p.data.note ?? null, url: p.data.url ?? null, priceCents: p.data.price ?? null })
    .returning();
  return { ok: true, want: shape(row!) };
}

export async function updateWant(id: number, input: unknown): Promise<{ ok: true; want: Want | null } | { ok: false; issues: { path: string; message: string }[] }> {
  const p = WantPatch.safeParse(input);
  if (!p.success) return { ok: false, issues: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  const { price, ...rest } = p.data;
  const set = { ...rest, ...(price !== undefined ? { priceCents: price } : {}), updatedAt: new Date() };
  const [row] = await db().update(wants).set(set).where(eq(wants.id, id)).returning();
  return { ok: true, want: row ? shape(row) : null };
}

export async function deleteWant(id: number): Promise<boolean> {
  const rows = await db().delete(wants).where(eq(wants.id, id)).returning({ id: wants.id });
  return rows.length > 0;
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

const denied = (status: 401 | 403) => json({ error: status === 401 ? "unauthorized" : "forbidden" }, status);
const invalid = (issues: { path: string; message: string }[]) => json({ error: "invalid", issues }, 400);

// GET /api/v1/wants and POST /api/v1/wants
export async function handleWants(req: Request): Promise<Response> {
  const write = req.method === "POST";
  const auth = await verifyBearer(req.headers.get("authorization"), write ? "log:write" : "log:read");
  if (!auth.ok) return denied(auth.status);
  try {
    if (!write) return json({ wants: await listWants() });
    const b = await readBody(req);
    if (!b.ok) return b.res;
    const r = await addWant(b.body);
    return r.ok ? json(r.want, 201) : invalid(r.issues);
  } catch (e) {
    console.error("wants: failed", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}

// PATCH and DELETE /api/v1/wants/{id}
export async function handleWant(req: Request, rawId: string): Promise<Response> {
  const auth = await verifyBearer(req.headers.get("authorization"), "log:write");
  if (!auth.ok) return denied(auth.status);
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) return json({ error: "not_found" }, 404);
  try {
    if (req.method === "DELETE") return (await deleteWant(id)) ? json({ ok: true }) : json({ error: "not_found" }, 404);
    const b = await readBody(req);
    if (!b.ok) return b.res;
    const r = await updateWant(id, b.body);
    if (!r.ok) return invalid(r.issues);
    return r.want ? json(r.want) : json({ error: "not_found" }, 404);
  } catch (e) {
    console.error("wants: failed", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}
