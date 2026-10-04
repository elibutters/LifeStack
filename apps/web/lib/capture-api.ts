import "server-only";
import { CAFFEINE_PRESETS, describeEntry, EventInput, presetSupplement, type Scope } from "./capture-core";
import { deleteLog, insertLog, listSupplements, loadFeed, loadToday } from "./capture";
import { describeError } from "./errors";
import { verifyBearer, type VerifiedToken } from "./tokens";

// Request handlers for /api/v1/*. That path skips the session gate in proxy.ts, so every handler
// here must authenticate with a bearer token itself, and fails closed.
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const MAX_BODY = 2048;

// A verified token, or the response to send back instead.
async function authenticate(req: Request, scope: Scope): Promise<VerifiedToken | Response> {
  const r = await verifyBearer(req.headers.get("authorization"), scope);
  return r.ok ? r.token : json({ error: r.status === 401 ? "unauthorized" : "forbidden" }, r.status);
}

export async function handleEvents(req: Request): Promise<Response> {
  const token = await authenticate(req, "log:write");
  if (token instanceof Response) return token;

  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: "too_large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = EventInput.safeParse(body);
  if (!parsed.success) {
    // Paths and reasons only; the values sent are never echoed back.
    return json({ error: "invalid", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
  }
  try {
    const r = await insertLog(parsed.data, token.kind);
    if (!r.ok) return json({ error: "invalid", issues: [{ path: "at", message: r.error }] }, 400);
    return json({ id: r.id, ts: r.ts.toISOString(), created: r.created }, r.created ? 201 : 200);
  } catch (e) {
    console.error("capture: could not save", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}

// A small summary built for widgets: today's mood, caffeine and supplements.
export async function handleToday(req: Request): Promise<Response> {
  const token = await authenticate(req, "log:read");
  if (token instanceof Response) return token;
  try {
    const { date, summary } = await loadToday();
    return json({
      date,
      mood: summary.mood && { value: summary.mood.value, at: summary.mood.at.toISOString(), count: summary.mood.count },
      caffeine: { count: summary.caffeine.count, mg: summary.caffeine.mg, lastAt: summary.caffeine.lastAt?.toISOString() ?? null },
      supplements: summary.supplements.map((s) => ({ name: s.name, count: s.count, lastAt: s.lastAt.toISOString() })),
    });
  } catch (e) {
    console.error("capture: could not read today", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}

const supplementJson = (s: { name: string }) => {
  const p = presetSupplement(s.name);
  return { name: s.name, dose: p?.dose ?? null, unit: p?.unit ?? null };
};

// The supplements and caffeine drinks offered in the quick log, with their default amounts, so a client shows
// the same buttons and doses as the web app instead of keeping its own list.
export async function handleOptions(req: Request): Promise<Response> {
  const token = await authenticate(req, "log:read");
  if (token instanceof Response) return token;
  try {
    return json({ supplements: (await listSupplements()).map(supplementJson), caffeine: CAFFEINE_PRESETS.map((c) => ({ drink: c.drink, mg: c.mg })) });
  } catch (e) {
    console.error("capture: could not list options", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}

// The supplement names offered in the quick log, so a client can show one button for each.
export async function handleSupplements(req: Request): Promise<Response> {
  const token = await authenticate(req, "log:read");
  if (token instanceof Response) return token;
  try {
    return json({ supplements: (await listSupplements()).map(supplementJson) });
  } catch (e) {
    console.error("capture: could not list supplements", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}

// Recent entries with their ids, so a client can show what was logged and let the person remove a mistake.
export async function handleHistory(req: Request): Promise<Response> {
  const token = await authenticate(req, "log:read");
  if (token instanceof Response) return token;
  const n = Number(new URL(req.url).searchParams.get("limit") ?? 50);
  const limit = Number.isInteger(n) && n >= 1 && n <= 200 ? n : 50;
  try {
    const rows = await loadFeed(limit);
    return json({ entries: rows.map((e) => ({ id: e.id, at: e.ts.toISOString(), key: e.key, label: describeEntry(e), source: e.source, name: e.key === "supplement.taken" ? e.valueText : null, dose: e.key === "supplement.taken" ? e.valueNum : null, unit: e.unit ?? null })) });
  } catch (e) {
    console.error("capture: could not read history", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}

// Removes one logged entry (mood, caffeine or supplement only; nothing else in the events table).
export async function handleDeleteEntry(req: Request, rawId: string): Promise<Response> {
  const token = await authenticate(req, "log:write");
  if (token instanceof Response) return token;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id < 1) return json({ error: "invalid" }, 400);
  try {
    return (await deleteLog(id)) ? json({ deleted: true }) : json({ error: "not_found" }, 404);
  } catch (e) {
    console.error("capture: could not delete", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}
