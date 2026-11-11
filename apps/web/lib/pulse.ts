import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { describeError } from "./errors";
import { verifyBearer } from "./tokens";

// A cheap "has anything changed?" for the phone. The number comes from a database sequence that triggers move forward whenever data the
// app shows changes (migration 0021). The phone asks every few seconds and reloads the open screen only when the number has moved,
// so it learns about a change made by an agent, the web or a sync within seconds without reloading everything on a timer.
export async function currentVersion(): Promise<number> {
  const rows = await db().execute(sql`select case when is_called then last_value else 0 end as v from data_version_seq`);
  return Number((rows as unknown as { v: string | number }[])[0]?.v ?? 0);
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

// GET /api/v1/pulse: any valid key. /api/v1/ skips the session gate, so this authenticates itself and fails closed.
export async function handlePulse(req: Request): Promise<Response> {
  const auth = await verifyBearer(req.headers.get("authorization"));
  if (!auth.ok) return json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, auth.status);
  try {
    return json({ version: await currentVersion() });
  } catch (e) {
    console.error("pulse: could not read", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}
