import "server-only";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { wantOptions, wants } from "@lifestack/db";
import { db } from "./db";
import { describeError } from "./errors";
import { verifyBearer } from "./tokens";
import { atTarget, bestPrice, OptionInput, OptionPatch, WantInput, WantPatch, type OptionStatus, type Want, type WantOption, type WantStatus } from "./wants-core";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const MAX_BODY = 4096;

type Issues = { path: string; message: string }[];
type Fail = { ok: false; issues: Issues };
const issuesOf = (e: { issues: { path: PropertyKey[]; message: string }[] }): Issues => e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));

const shapeOption = (r: typeof wantOptions.$inferSelect): WantOption => ({
  id: r.id,
  wantId: r.wantId,
  title: r.title,
  url: r.url,
  priceCents: r.priceCents,
  priceCheckedAt: r.priceCheckedAt?.toISOString() ?? null,
  targetCents: r.targetCents,
  note: r.note,
  status: r.status as OptionStatus,
  atTarget: atTarget(r.priceCents, r.targetCents),
});

const shapeWant = (r: typeof wants.$inferSelect, options: WantOption[]): Want => ({
  id: r.id,
  title: r.title,
  note: r.note,
  budgetCents: r.budgetCents,
  status: r.status as WantStatus,
  createdAt: r.createdAt.toISOString(),
  bestPriceCents: bestPrice(options),
  options,
});

export async function listWants(): Promise<Want[]> {
  const rows = await db().select().from(wants).orderBy(desc(wants.createdAt)).limit(300);
  const opts = await db().select().from(wantOptions).orderBy(asc(wantOptions.createdAt));
  return rows.map((w) => shapeWant(w, opts.filter((o) => o.wantId === w.id).map(shapeOption)));
}

// A want and, when input.first is given, one first option carrying the same title.
export async function addWant(input: unknown): Promise<{ ok: true; id: number } | Fail> {
  const p = WantInput.safeParse(input);
  if (!p.success) return { ok: false, issues: issuesOf(p.error) };
  const first = (input as { first?: unknown }).first;
  let option: ReturnType<typeof OptionInput.parse> | null = null;
  if (first !== undefined && first !== null) {
    const o = OptionInput.safeParse({ title: p.data.title, ...(first as object) });
    if (!o.success) return { ok: false, issues: issuesOf(o.error) };
    option = o.data;
  }
  const id = await db().transaction(async (tx) => {
    const [w] = await tx.insert(wants).values({ title: p.data.title, note: p.data.note ?? null, budgetCents: p.data.budget ?? null }).returning({ id: wants.id });
    if (option) {
      await tx.insert(wantOptions).values({
        wantId: w!.id,
        title: option.title,
        url: option.url ?? null,
        priceCents: option.price ?? null,
        priceCheckedAt: option.price != null ? new Date() : null,
        targetCents: option.target ?? null,
        note: option.note ?? null,
      });
    }
    return w!.id;
  });
  return { ok: true, id };
}

export async function updateWant(id: number, input: unknown): Promise<{ ok: true; found: boolean } | Fail> {
  const p = WantPatch.safeParse(input);
  if (!p.success) return { ok: false, issues: issuesOf(p.error) };
  const { budget, ...rest } = p.data;
  const set = { ...rest, ...(budget !== undefined ? { budgetCents: budget } : {}), updatedAt: new Date() };
  const found = await db().transaction(async (tx) => {
    const rows = await tx.update(wants).set(set).where(eq(wants.id, id)).returning({ id: wants.id });
    // Reopening a bought want puts its chosen option back in the running.
    if (rows.length && p.data.status === "want") await tx.update(wantOptions).set({ status: "considering" }).where(and(eq(wantOptions.wantId, id), eq(wantOptions.status, "chosen")));
    return rows.length > 0;
  });
  return { ok: true, found };
}

export async function deleteWant(id: number): Promise<boolean> {
  return (await db().delete(wants).where(eq(wants.id, id)).returning({ id: wants.id })).length > 0;
}

export async function addOption(wantId: number, input: unknown): Promise<{ ok: true; id: number } | { ok: false; notFound: true } | Fail> {
  const p = OptionInput.safeParse(input);
  if (!p.success) return { ok: false, issues: issuesOf(p.error) };
  const [w] = await db().select({ id: wants.id }).from(wants).where(eq(wants.id, wantId));
  if (!w) return { ok: false, notFound: true };
  const [row] = await db()
    .insert(wantOptions)
    .values({ wantId, title: p.data.title, url: p.data.url ?? null, priceCents: p.data.price ?? null, priceCheckedAt: p.data.price != null ? new Date() : null, targetCents: p.data.target ?? null, note: p.data.note ?? null })
    .returning({ id: wantOptions.id });
  return { ok: true, id: row!.id };
}

export async function updateOption(id: number, input: unknown): Promise<{ ok: true; found: boolean } | Fail> {
  const p = OptionPatch.safeParse(input);
  if (!p.success) return { ok: false, issues: issuesOf(p.error) };
  const { price, target, ...rest } = p.data;
  const set = {
    ...rest,
    ...(price !== undefined ? { priceCents: price, priceCheckedAt: new Date() } : {}),
    ...(target !== undefined ? { targetCents: target } : {}),
  };
  const found = await db().transaction(async (tx) => {
    const [row] = await tx.update(wantOptions).set(set).where(eq(wantOptions.id, id)).returning({ wantId: wantOptions.wantId });
    if (!row) return false;
    // Choosing an option is buying the want: the others drop out and the want is done.
    if (p.data.status === "chosen") {
      await tx.update(wantOptions).set({ status: "rejected" }).where(and(eq(wantOptions.wantId, row.wantId), ne(wantOptions.id, id)));
      await tx.update(wants).set({ status: "bought", updatedAt: new Date() }).where(eq(wants.id, row.wantId));
    }
    return true;
  });
  return { ok: true, found };
}

export async function deleteOption(id: number): Promise<boolean> {
  return (await db().delete(wantOptions).where(eq(wantOptions.id, id)).returning({ id: wantOptions.id })).length > 0;
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
const invalid = (issues: Issues) => json({ error: "invalid", issues }, 400);
const notFound = () => json({ error: "not_found" }, 404);
const idOf = (raw: string) => (/^\d{1,15}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null);

// Shared by every handler: bearer check, id parse, body read, and a uniform error path.
async function handle(req: Request, scope: "log:read" | "log:write", rawId: string | null, fn: (id: number | null, body: unknown) => Promise<Response>): Promise<Response> {
  const auth = await verifyBearer(req.headers.get("authorization"), scope);
  if (!auth.ok) return denied(auth.status);
  const id = rawId === null ? null : idOf(rawId);
  if (rawId !== null && id === null) return notFound();
  try {
    let body: unknown;
    if (req.method !== "GET" && req.method !== "DELETE") {
      const b = await readBody(req);
      if (!b.ok) return b.res;
      body = b.body;
    }
    return await fn(id, body);
  } catch (e) {
    console.error("wants: failed", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}

// GET (list) and POST (add) /api/v1/wants. POST takes title, note, budget and an optional "first" option.
export const handleWants = (req: Request) =>
  handle(req, req.method === "POST" ? "log:write" : "log:read", null, async (_id, body) => {
    if (req.method !== "POST") return json({ wants: await listWants() });
    const r = await addWant(body);
    return r.ok ? json({ id: r.id }, 201) : invalid(r.issues);
  });

// PATCH and DELETE /api/v1/wants/{id}
export const handleWant = (req: Request, rawId: string) =>
  handle(req, "log:write", rawId, async (id, body) => {
    if (req.method === "DELETE") return (await deleteWant(id!)) ? json({ ok: true }) : notFound();
    const r = await updateWant(id!, body);
    return !r.ok ? invalid(r.issues) : r.found ? json({ ok: true }) : notFound();
  });

// POST /api/v1/wants/{id}/options
export const handleAddOption = (req: Request, rawId: string) =>
  handle(req, "log:write", rawId, async (id, body) => {
    const r = await addOption(id!, body);
    if (r.ok) return json({ id: r.id }, 201);
    return "notFound" in r ? notFound() : invalid(r.issues);
  });

// PATCH and DELETE /api/v1/want-options/{id}. A price update stamps the time it was checked.
export const handleOption = (req: Request, rawId: string) =>
  handle(req, "log:write", rawId, async (id, body) => {
    if (req.method === "DELETE") return (await deleteOption(id!)) ? json({ ok: true }) : notFound();
    const r = await updateOption(id!, body);
    return !r.ok ? invalid(r.issues) : r.found ? json({ ok: true }) : notFound();
  });
