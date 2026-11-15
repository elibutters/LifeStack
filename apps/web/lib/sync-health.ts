import "server-only";
import { eq } from "drizzle-orm";
import { connections, syncState } from "@lifestack/db";
import { db } from "./db";
import { listItems } from "./finance";
import { readCursor } from "./notion-core";
import { checkAll, type SourceInput } from "./sync-health-core";

// Which sources should be syncing, and when each last did. A source counts only if it is connected, so one that was never set up is not a
// problem. Notion's "last good run" is the time stamped into its cursor, because a sweep does not set lastOkAt (only a finished walk does).
const LABELS: Record<string, string> = { outlook: "Outlook calendar", strava: "Strava", eight: "Eight Sleep", notion: "Notion" };

export async function loadSyncHealth(now = new Date()) {
  const [links, states, items] = await Promise.all([db().select({ provider: connections.provider }).from(connections), db().select().from(syncState), listItems().catch(() => [])]);
  const connected = new Set(links.map((l) => l.provider));
  const state = new Map(states.map((s) => [s.source, s]));
  const sources: SourceInput[] = [];
  for (const [key, label] of Object.entries(LABELS)) {
    if (!connected.has(key)) continue;
    const s = state.get(key);
    const ran = key === "notion" ? readCursor(s?.cursor ?? null).ranAt : undefined;
    sources.push({ key, label, lastOkAt: ran ? new Date(ran) : (s?.lastOkAt ?? null), lastError: s?.lastError ?? null });
  }
  const mail = state.get("outlook-mail");
  if (connected.has("outlook") && mail) sources.push({ key: "outlook-mail", label: "Outlook mail", lastOkAt: mail.lastOkAt ?? null, lastError: mail.lastError ?? null });
  items.forEach((i, n) => sources.push({ key: `plaid-${n + 1}`, label: i.institutionName && i.institutionName !== "…" ? i.institutionName : `Bank ${n + 1}`, lastOkAt: i.lastSyncedAt ?? null, lastError: i.status !== "ok" ? (i.lastError ?? "It needs to be linked again.") : (i.lastError ?? null) }));
  return checkAll(sources, now);
}
