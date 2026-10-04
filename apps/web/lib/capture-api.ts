import "server-only";
import { EventInput, type Scope } from "./capture-core";
import { insertLog, listSupplements, loadToday } from "./capture";
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

// The supplement names offered in the quick log, so a client can show one button for each.
export async function handleSupplements(req: Request): Promise<Response> {
  const token = await authenticate(req, "log:read");
  if (token instanceof Response) return token;
  try {
    return json({ supplements: (await listSupplements()).map((s) => ({ name: s.name })) });
  } catch (e) {
    console.error("capture: could not list supplements", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}
