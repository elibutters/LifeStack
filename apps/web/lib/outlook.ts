import "server-only";
import { and, eq, gte, lt, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { connections, events, syncState } from "@lifestack/db";
import { decrypt, encrypt } from "./crypto";
import { db } from "./db";
import { addDays, startOfDay, ymd } from "./dates";
import { GRAPH, graphGet, refreshTokens, TokenError } from "./microsoft";
import { toRow, type EventRow } from "./outlook-map";

export const OUTLOOK = "outlook";

const FRESH_MS = 15 * 60 * 1000; // sync on open if the last success is older than this
const RETRY_MS = 2 * 60 * 1000; // but never more often than this, even after a failure
const MAX_PAGES = 60;

export async function getConnection() {
  const [row] = await db().select().from(connections).where(eq(connections.provider, OUTLOOK));
  return row ?? null;
}

export async function getSyncState() {
  const [row] = await db().select().from(syncState).where(eq(syncState.source, OUTLOOK));
  return row ?? null;
}

export async function saveConnection(refreshToken: string, account: string | null) {
  const row = { provider: OUTLOOK, account, refreshTokenEnc: encrypt(refreshToken), updatedAt: new Date() };
  await db()
    .insert(connections)
    .values(row)
    .onConflictDoUpdate({ target: connections.provider, set: row });
}

export async function disconnectOutlook() {
  await db().delete(connections).where(eq(connections.provider, OUTLOOK));
  await db().delete(syncState).where(eq(syncState.source, OUTLOOK));
  await db().delete(events).where(eq(events.source, OUTLOOK));
}

const Me = z.object({ mail: z.string().nullish(), userPrincipalName: z.string().nullish() });

export async function fetchAccount(accessToken: string): Promise<string | null> {
  const me = Me.safeParse(await graphGet(`${GRAPH}/me?$select=mail,userPrincipalName`, accessToken));
  return me.success ? (me.data.mail ?? me.data.userPrincipalName ?? null) : null;
}

const Page = z.object({ value: z.array(z.unknown()), "@odata.nextLink": z.string().optional() });

// The sync cursor column holds the time of the last attempt, which throttles retries.
async function recordState(set: { lastOkAt?: Date; lastError?: string | null; cursor?: string }) {
  await db()
    .insert(syncState)
    .values({ source: OUTLOOK, ...set })
    .onConflictDoUpdate({ target: syncState.source, set });
}

// Pulls a fixed window of the primary calendar and makes the stored copy match it. Re-running
// never duplicates rows, and events deleted or moved in Outlook disappear here too.
export async function syncOutlook(): Promise<{ events: number } | null> {
  const conn = await getConnection();
  if (!conn) return null;
  await recordState({ cursor: new Date().toISOString() });
  try {
    const tokens = await refreshTokens(decrypt(conn.refreshTokenEnc));
    if (tokens.refresh_token) await saveConnection(tokens.refresh_token, conn.account);

    const today = ymd(new Date());
    const from = startOfDay(addDays(today, -30));
    const to = startOfDay(addDays(today, 366));
    const qs = new URLSearchParams({
      startDateTime: from.toISOString(),
      endDateTime: to.toISOString(),
      $select: "id,subject,start,end,isAllDay,isCancelled,location",
      $top: "100",
    });

    const rows = new Map<string, EventRow>();
    let next: string | undefined = `${GRAPH}/me/calendarView?${qs}`;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const body = Page.parse(await graphGet(next, tokens.access_token));
      for (const raw of body.value) {
        const row = toRow(raw, startOfDay);
        if (row) rows.set(row.sourceId, row);
      }
      next = body["@odata.nextLink"];
    }
    if (next) throw new Error("calendar too large to sync");

    const list = [...rows.values()];
    for (let i = 0; i < list.length; i += 500) {
      await db()
        .insert(events)
        .values(list.slice(i, i + 500))
        .onConflictDoUpdate({
          target: [events.source, events.sourceId],
          set: { ts: sql`excluded.ts`, payload: sql`excluded.payload` },
        });
    }
    await db()
      .delete(events)
      .where(
        and(
          eq(events.source, OUTLOOK),
          gte(events.ts, from),
          lt(events.ts, to),
          list.length ? notInArray(events.sourceId, [...rows.keys()]) : undefined,
        ),
      );

    await recordState({ lastOkAt: new Date(), lastError: null });
    return { events: list.length };
  } catch (e) {
    const expired = e instanceof TokenError && e.code === "invalid_grant";
    console.error("outlook: sync failed", e instanceof Error ? e.message : "unknown error");
    await recordState({ lastError: expired ? "Microsoft sign-in expired. Reconnect Outlook." : "Sync failed. It will retry." });
    throw e;
  }
}

// Called after a page renders, so opening the app keeps the calendar fresh without delaying it.
export async function syncOutlookIfStale() {
  try {
    if (!(await getConnection())) return;
    const state = await getSyncState();
    const now = Date.now();
    if (now - (state?.lastOkAt?.getTime() ?? 0) < FRESH_MS) return;
    if (now - (state?.cursor ? Date.parse(state.cursor) || 0 : 0) < RETRY_MS) return;
    await syncOutlook();
  } catch {
    // Recorded in sync_state; the Settings page shows it.
  }
}
