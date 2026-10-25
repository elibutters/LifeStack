import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { after } from "next/server";
import { events } from "@lifestack/db";
import { db } from "./db";
import { outcomeOf, type Call } from "./mcp-usage-core";

// Every tools/call is recorded as an events row (domain "mcp", key "mcp.call"): the tool, which key, how long, whether it worked, the
// size of the answer, and the NAMES of the arguments. Argument values and results are never stored. Recording never fails a call.
type Rpc = { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };

export function callsIn(body: unknown): { tool: string; argKeys: string[] }[] {
  const list = Array.isArray(body) ? body : [body];
  return list.flatMap((m: Rpc) => (m && m.method === "tools/call" && typeof m.params?.name === "string" ? [{ tool: m.params.name.slice(0, 80), argKeys: Object.keys(m.params.arguments ?? {}).slice(0, 30).map((k) => k.slice(0, 40)) }] : []));
}

export async function recordCalls(body: unknown, res: Response, tokenId: number, started: number) {
  const calls = callsIn(body);
  if (!calls.length) return;
  const ms = Date.now() - started;
  const parsed = await res.clone().json().catch(() => null);
  const out = outcomeOf(parsed);
  const rows = calls.map((c) => ({
    ts: new Date(), domain: "mcp", key: "mcp.call", valueNum: ms, valueText: c.tool,
    payload: { tokenId, argKeys: c.argKeys, outcome: out.outcome, bytes: out.bytes, ...(out.error ? { error: out.error } : {}) },
    source: "mcp", sourceId: randomUUID(),
  }));
  await db().insert(events).values(rows);
}

// After the response has gone out when in a request, otherwise in the background. Never throws.
export function recordAfter(body: unknown, res: Response, tokenId: number, started: number) {
  const run = () => recordCalls(body, res, tokenId, started).catch(() => {});
  try {
    after(run);
  } catch {
    void run();
  }
}

export async function loadCalls(days: number, now = new Date()): Promise<Call[]> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await db().select().from(events).where(and(eq(events.source, "mcp"), eq(events.key, "mcp.call"), gte(events.ts, since))).orderBy(desc(events.ts)).limit(20000);
  return rows.map((r) => {
    const p = r.payload as { tokenId?: number; argKeys?: string[]; outcome?: Call["outcome"]; bytes?: number; error?: string };
    return { at: r.ts, tool: r.valueText ?? "?", tokenId: p.tokenId ?? null, ms: r.valueNum ?? 0, outcome: p.outcome ?? "ok", bytes: p.bytes ?? 0, argKeys: p.argKeys ?? [], error: p.error };
  });
}
