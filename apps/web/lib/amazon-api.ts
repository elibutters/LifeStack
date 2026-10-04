import "server-only";
import { describeError } from "./errors";
import { ingestSnapshot, parseSnapshot } from "./amazon";
import { verifyBearer } from "./tokens";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const MAX_BODY = 1_000_000;

export async function handleAmazonSnapshot(req: Request): Promise<Response> {
  const auth = await verifyBearer(req.headers.get("authorization"), "amazon:write");
  if (!auth.ok) return json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, auth.status);

  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: "too_large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = parseSnapshot(body);
  if (!parsed.success) {
    return json({ error: "invalid", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
  }
  try {
    const r = await ingestSnapshot(parsed.data);
    if ("loginRequired" in r) return json({ ok: true, loginRequired: true });
    return json({ ok: true, orders: r.orders, cart: r.cart });
  } catch (e) {
    console.error("amazon: snapshot failed", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}
