import "server-only";
import { and, desc, eq, gte } from "drizzle-orm";
import { locationPoints, places } from "@lifestack/db";
import { db } from "./db";
import { describeError } from "./errors";
import { BatchInput, notTooFuture, PlaceInput, staysOf, type Place } from "./location-core";
import { verifyBearer } from "./tokens";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const MAX_BODY = 64 * 1024;

export async function listPlaces(): Promise<Place[]> {
  const rows = await db().select().from(places).orderBy(places.label);
  return rows.map((r) => ({ id: r.id, label: r.label, lat: r.lat, lon: r.lon, radiusM: r.radiusM }));
}

export async function addPlace(input: unknown): Promise<{ ok: true; id: number } | { ok: false }> {
  const p = PlaceInput.safeParse(input);
  if (!p.success) return { ok: false };
  const [row] = await db().insert(places).values({ label: p.data.label, lat: p.data.lat, lon: p.data.lon, radiusM: p.data.radiusM }).returning({ id: places.id });
  return { ok: true, id: row!.id };
}

export async function deletePlace(id: number): Promise<boolean> {
  return (await db().delete(places).where(eq(places.id, id)).returning({ id: places.id })).length > 0;
}

// Idempotent: a point the phone sends twice (a retried upload) is stored once.
export async function storePoints(input: unknown, now = new Date()): Promise<{ ok: true; received: number; stored: number } | { ok: false; error: string }> {
  const p = BatchInput.safeParse(input);
  if (!p.success) return { ok: false, error: "invalid" };
  if (p.data.points.some((x) => !notTooFuture(x.at, now))) return { ok: false, error: "invalid" };
  const rows = await db()
    .insert(locationPoints)
    .values(p.data.points.map((x) => ({ clientId: x.id, ts: new Date(x.at), lat: x.lat, lon: x.lon, accuracyM: x.accuracyM ?? null, source: x.source })))
    .onConflictDoNothing({ target: locationPoints.clientId })
    .returning({ id: locationPoints.id });
  return { ok: true, received: p.data.points.length, stored: rows.length };
}

export async function loadHistory(days = 7, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const [pts, pl] = await Promise.all([
    db().select().from(locationPoints).where(gte(locationPoints.ts, since)).orderBy(desc(locationPoints.ts)).limit(5000),
    listPlaces(),
  ]);
  const points = pts.map((r) => ({ ts: r.ts, lat: r.lat, lon: r.lon, source: r.source }));
  const latest = pts[0] ? { at: pts[0].ts.toISOString(), lat: pts[0].lat, lon: pts[0].lon, accuracyM: pts[0].accuracyM, source: pts[0].source } : null;
  return { latest, stays: staysOf(points, pl, now), places: pl };
}

async function guarded(req: Request, scope: "location:read" | "location:write", fn: (body: unknown) => Promise<Response>, hasBody: boolean): Promise<Response> {
  const auth = await verifyBearer(req.headers.get("authorization"), scope);
  if (!auth.ok) return json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, auth.status);
  try {
    let body: unknown;
    if (hasBody) {
      const text = await req.text();
      if (text.length > MAX_BODY) return json({ error: "too_large" }, 413);
      try { body = JSON.parse(text); } catch { return json({ error: "invalid_json" }, 400); }
    }
    return await fn(body);
  } catch (e) {
    console.error("location: failed", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}

// POST /api/v1/location (the phone uploads) and GET /api/v1/location?days=7 (stays, latest point, named places)
export const handleLocation = (req: Request) =>
  req.method === "POST"
    ? guarded(req, "location:write", async (body) => {
        const r = await storePoints(body);
        return r.ok ? json({ received: r.received, stored: r.stored }, 201) : json({ error: r.error }, 400);
      }, true)
    : guarded(req, "location:read", async () => {
        const d = Number(new URL(req.url).searchParams.get("days") ?? 7);
        if (!Number.isInteger(d) || d < 1 || d > 365) return json({ error: "invalid" }, 400);
        return json(await loadHistory(d));
      }, false);

// GET and POST /api/v1/places
export const handlePlaces = (req: Request) =>
  req.method === "POST"
    ? guarded(req, "location:write", async (body) => {
        const r = await addPlace(body);
        return r.ok ? json({ id: r.id }, 201) : json({ error: "invalid" }, 400);
      }, true)
    : guarded(req, "location:read", async () => json({ places: await listPlaces() }), false);

// DELETE /api/v1/places/{id}
export const handlePlace = (req: Request, rawId: string) =>
  guarded(req, "location:write", async () => {
    const id = /^\d{1,15}$/.test(rawId) ? Number(rawId) : 0;
    return id && (await deletePlace(id)) ? json({ ok: true }) : json({ error: "not_found" }, 404);
  }, false);
