import "server-only";
import { z } from "zod";
import type { Scope } from "./capture-core";
import { addDays, isValidDay, ymd } from "./dates";
import { describeError } from "./errors";
import { verifyBearer } from "./tokens";
import { calendarRange, connectionsStatus, financeSummary, holdingsList, MAX_RANGE_DAYS, overview, searchTransactions, sleepNights } from "./app-data";

// Read-only JSON endpoints for the iPhone app (and any other client). /api/v1/ skips the session gate
// in proxy.ts, so each handler authenticates with a bearer key and its scope, and fails closed.
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const bad = (message: string) => json({ error: "invalid", message }, 400);

async function run(req: Request, scope: Scope, fn: (url: URL, has: (s: string) => boolean) => Promise<Response>): Promise<Response> {
  const auth = await verifyBearer(req.headers.get("authorization"), scope);
  if (!auth.ok) return json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, auth.status);
  try {
    return await fn(new URL(req.url), (s) => auth.token.scopes.includes(s));
  } catch (e) {
    console.error("api: could not read", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}

const Day = z.string().refine(isValidDay);
const int = (v: string | null, min: number, max: number, fallback: number) => {
  const n = v == null ? fallback : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

// The home screen mixes areas, so it needs only that the key is valid; sections follow its scopes.
export const handleOverview = async (req: Request) => {
  const auth = await verifyBearer(req.headers.get("authorization"));
  if (!auth.ok) return json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, auth.status);
  try {
    return json(await overview((s) => auth.token.scopes.includes(s)));
  } catch (e) {
    console.error("api: could not build the overview", describeError(e));
    return json({ error: "server_error" }, 500);
  }
};

export const handleCalendar = (req: Request) =>
  run(req, "calendar:read", async (url) => {
    const from = url.searchParams.get("from") ?? ymd(new Date());
    const to = url.searchParams.get("to") ?? addDays(from, 30);
    if (!Day.safeParse(from).success || !Day.safeParse(to).success) return bad("from and to must be YYYY-MM-DD");
    if (to < from) return bad("to is before from");
    if (addDays(from, MAX_RANGE_DAYS) < to) return bad(`range is limited to ${MAX_RANGE_DAYS} days`);
    return json({ from, to, items: await calendarRange(from, to) });
  });

export const handleSleep = (req: Request) =>
  run(req, "sleep:read", async (url) => {
    const n = int(url.searchParams.get("nights"), 1, 60, 14);
    if (n == null) return bad("nights must be 1 to 60");
    return json({ nights: await sleepNights(n) });
  });

export const handleFinance = (req: Request) =>
  run(req, "finance:read", async () => {
    const s = await financeSummary();
    return s ? json(s) : json({ error: "unavailable" }, 503);
  });

export const handleTransactions = (req: Request) =>
  run(req, "finance:read", async (url) => {
    const p = url.searchParams;
    const from = p.get("from") ?? undefined;
    const to = p.get("to") ?? undefined;
    const limit = int(p.get("limit"), 1, 200, 50);
    if (limit == null || (from && !Day.safeParse(from).success) || (to && !Day.safeParse(to).success)) return bad("invalid filter");
    const rows = await searchTransactions({ text: p.get("text")?.slice(0, 80) ?? undefined, category: p.get("category")?.slice(0, 60) ?? undefined, from, to, limit });
    return rows ? json({ transactions: rows }) : json({ error: "unavailable" }, 503);
  });

export const handleHoldings = (req: Request) => run(req, "finance:read", async () => json({ holdings: await holdingsList() }));

export const handleConnections = (req: Request) => run(req, "account:read", async () => json(await connectionsStatus()));
