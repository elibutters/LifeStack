import "server-only";
import { and, eq, gte } from "drizzle-orm";
import { events } from "@lifestack/db";
import { db } from "./db";
import { describeError } from "./errors";
import { verifyBearer } from "./tokens";
import { logSession } from "./session-log";
import { minutesBetween, sessionIdOf, split, STOPPED_MEMORY_MS, TimerInput, type TimerState } from "./timer-core";

// The session timer: one row per calendar item in `events` (source "timer"), so a start or stop on one device is seen by every other
// device, the Mac and the agents. The pulse (migration 0021) moves on every change, which is how the open apps learn of it.
const SRC = "timer";
const KEY = "session.timer";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

const shape = (r: typeof events.$inferSelect): TimerState => {
  const p = r.payload as Partial<TimerState>;
  return { itemKey: String(p.itemKey ?? ""), title: String(p.title ?? ""), style: (p.style as TimerState["style"]) ?? "event", plan: Array.isArray(p.plan) ? p.plan : [], startedAt: String(p.startedAt ?? r.ts.toISOString()), stoppedAt: p.stoppedAt ?? null };
};

export async function readTimers(now = new Date()) {
  const since = new Date(now.getTime() - STOPPED_MEMORY_MS);
  const rows = await db().select().from(events).where(and(eq(events.source, SRC), eq(events.key, KEY), gte(events.ts, since)));
  const running = await db().select().from(events).where(and(eq(events.source, SRC), eq(events.key, KEY), eq(events.valueText, "running")));
  const all = new Map([...rows, ...running].map((r) => [r.sourceId, r]));
  return split([...all.values()].map(shape), now);
}

// Starting is idempotent: a second start for the item already running changes nothing, so two devices tapping at once agree on one start time.
export async function startTimer(input: { itemKey: string; title: string; style: TimerState["style"]; plan: string[] }, now = new Date()): Promise<TimerState> {
  return db().transaction(async (tx) => {
    const rows = await tx.select().from(events).where(and(eq(events.source, SRC), eq(events.key, KEY), eq(events.valueText, "running")));
    const same = rows.find((r) => shape(r).itemKey === input.itemKey);
    if (same) return shape(same);
    for (const r of rows) {
      await tx.update(events).set({ valueText: "stopped", payload: { ...(r.payload as object), stoppedAt: now.toISOString() } }).where(eq(events.id, r.id));
    }
    const state: TimerState = { ...input, startedAt: now.toISOString(), stoppedAt: null };
    const values = { ts: now, domain: "session", key: KEY, valueText: "running", payload: state, source: SRC, sourceId: `timer:${input.itemKey}` };
    await tx.insert(events).values(values).onConflictDoUpdate({ target: [events.source, events.sourceId], set: { ts: values.ts, valueText: values.valueText, payload: values.payload } });
    return state;
  });
}

// Stopping a goal session's timer is how it gets done: the session is logged as done at the time it started, for as long as it ran (at least a
// minute). Other calendar items only keep the length in the timer record.
export async function stopTimer(itemKey: string, now = new Date()): Promise<{ stopped: boolean; minutes?: number; logged?: string; error?: string }> {
  const rows = await db().select().from(events).where(and(eq(events.source, SRC), eq(events.sourceId, `timer:${itemKey}`)));
  const row = rows[0];
  if (!row || row.valueText !== "running") return { stopped: false };
  const t = shape(row);
  const minutes = minutesBetween(t.startedAt, now.toISOString());
  await db().update(events).set({ valueText: "stopped", payload: { ...(row.payload as object), stoppedAt: now.toISOString(), minutes } }).where(eq(events.id, row.id));
  const sessionId = sessionIdOf(itemKey);
  if (!sessionId) return { stopped: true, minutes };
  const r = await logSession(sessionId, { start: t.startedAt, minutes: Math.max(1, minutes) }, now);
  return r.ok ? { stopped: true, minutes, logged: r.summary } : { stopped: true, minutes, error: r.error };
}

// GET /api/v1/timer: the running timer and the items stopped lately. POST: {action:"start"|"stop", itemKey, ...}. Any phone key can use it.
export async function handleTimer(req: Request): Promise<Response> {
  const auth = await verifyBearer(req.headers.get("authorization"), req.method === "POST" ? "log:write" : "log:read");
  if (!auth.ok) return json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, auth.status);
  try {
    if (req.method !== "POST") return json(await readTimers());
    const text = await req.text();
    if (text.length > 4096) return json({ error: "too_large" }, 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return json({ error: "invalid_json" }, 400); }
    const p = TimerInput.safeParse(body);
    if (!p.success) return json({ error: "invalid", issues: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
    if (p.data.action === "start") {
      const { action: _a, ...rest } = p.data;
      await startTimer(rest);
    } else {
      const r = await stopTimer(p.data.itemKey);
      return json({ ...(await readTimers()), ...(r.stopped ? { minutes: r.minutes, logged: r.logged ?? null } : {}) });
    }
    return json(await readTimers());
  } catch (e) {
    console.error("timer: failed", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}
