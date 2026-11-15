import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { events } from "@lifestack/db";
import { db } from "./db";
import { describeError } from "./errors";
import { addDay, localDay } from "./goals-core";
import { loadConstraints } from "./goals";
import { verifyBearer } from "./tokens";
import { briefId, BriefInput, currentBrief, type Brief } from "./brief-core";

// Briefs live in `events` (domain "brief"), one row per day and kind, so a second run for the same day replaces the first. The pulse moves when
// one is saved, so an open app shows it within seconds.
const SRC = "agent";
const KEY = "brief.daily";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

const shape = (r: typeof events.$inferSelect): Brief => {
  const p = r.payload as Partial<Brief>;
  return { id: String(p.id ?? ""), kind: p.kind ?? "morning", day: String(p.day ?? ""), headline: String(p.headline ?? ""), sections: Array.isArray(p.sections) ? p.sections : [], question: p.question ?? null, createdAt: r.ts.toISOString() };
};

export async function saveBrief(input: unknown, now = new Date()) {
  const p = BriefInput.safeParse(input);
  if (!p.success) return { ok: false as const, error: p.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ") };
  const c = await loadConstraints();
  const day = p.data.day ?? localDay(now, c.tz);
  const id = briefId(day, p.data.kind);
  const payload = { id, kind: p.data.kind, day, headline: p.data.headline, sections: p.data.sections, question: p.data.question ?? null };
  await db().insert(events).values({ ts: now, domain: "brief", key: KEY, valueText: p.data.kind, payload, source: SRC, sourceId: `brief:${id}` })
    .onConflictDoUpdate({ target: [events.source, events.sourceId], set: { ts: now, valueText: p.data.kind, payload } });
  return { ok: true as const, id, day, kind: p.data.kind };
}

export async function recentBriefs(limit = 6): Promise<Brief[]> {
  const rows = await db().select().from(events).where(and(eq(events.source, SRC), eq(events.key, KEY))).orderBy(desc(events.ts)).limit(limit);
  return rows.map(shape);
}

export async function latestBrief(now = new Date()): Promise<Brief | null> {
  const c = await loadConstraints();
  const today = localDay(now, c.tz);
  return currentBrief(await recentBriefs(), today, addDay(today, -1));
}

// GET /api/v1/brief: the brief to show now (or null). Any key with brief:read.
export async function handleBrief(req: Request): Promise<Response> {
  const auth = await verifyBearer(req.headers.get("authorization"), "brief:read");
  if (!auth.ok) return json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, auth.status);
  try {
    return json({ brief: await latestBrief() });
  } catch (e) {
    console.error("brief: failed", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}
