import "server-only";
import { and, count, eq, gte, isNull, lt, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { connections, events, syncState } from "@lifestack/db";
import { decrypt, encrypt } from "./crypto";
import { db } from "./db";
import { addDays, startOfDay, ymd } from "./dates";
import { GRAPH, graphGet, refreshTokens, TokenError } from "./microsoft";
import { toRow, type EventKind, type EventRow } from "./outlook-map";

export const OUTLOOK = "outlook";

const FRESH_MS = 15 * 60 * 1000; // sync on open if the last success is older than this
const RETRY_MS = 2 * 60 * 1000; // but never more often than this, even after a failure
const MAX_PAGES = 60;
const EXPIRED = "Microsoft sign-in expired. Reconnect Outlook.";

export type SyncResult = { events: number } | { skipped: true } | null;

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
  // Deleting the connection first also makes any sync that is mid-flight abandon its writes.
  await db().delete(connections).where(eq(connections.provider, OUTLOOK));
  await db().delete(syncState).where(eq(syncState.source, OUTLOOK));
  await db().delete(events).where(eq(events.source, OUTLOOK));
}

const Me = z.object({ mail: z.string().nullish(), userPrincipalName: z.string().nullish() });

export async function fetchAccount(accessToken: string): Promise<string | null> {
  const me = Me.safeParse(await graphGet(`${GRAPH}/me?$select=mail,userPrincipalName`, accessToken));
  return me.success ? (me.data.mail ?? me.data.userPrincipalName ?? null) : null;
}

const Calendars = z.object({ value: z.array(z.object({ id: z.string(), name: z.string().nullish() })) });

// Every calendar on the account is synced. One whose name contains "holiday" is tagged as a
// holiday calendar. Returns null if the list cannot be read (Microsoft has had intermittent
// errors on this call for personal accounts).
async function listCalendars(accessToken: string): Promise<{ id: string; kind: EventKind }[] | null> {
  try {
    const body = Calendars.parse(await graphGet(`${GRAPH}/me/calendars?$select=id,name&$top=50`, accessToken));
    return body.value.map((c) => ({ id: c.id, kind: /holiday/i.test(c.name ?? "") ? "holiday" : "event" }));
  } catch {
    console.error("outlook: could not list calendars; syncing the main calendar only");
    return null;
  }
}

const Page = z.object({ value: z.array(z.unknown()), "@odata.nextLink": z.string().optional() });

async function recordState(set: { lastOkAt?: Date; lastError?: string | null }) {
  await db()
    .insert(syncState)
    .values({ source: OUTLOOK, ...set })
    .onConflictDoUpdate({ target: syncState.source, set });
}

// Only one sync runs at a time. The lease expires on its own if a run is killed mid-way.
// The cursor column holds the time of the last attempt, which throttles retries.
async function claimLease(): Promise<boolean> {
  await db().insert(syncState).values({ source: OUTLOOK }).onConflictDoNothing();
  const claimed = await db()
    .update(syncState)
    .set({ leaseUntil: sql`now() + interval '5 minutes'`, cursor: new Date().toISOString() })
    .where(and(eq(syncState.source, OUTLOOK), sql`(${syncState.leaseUntil} is null or ${syncState.leaseUntil} < now())`))
    .returning({ source: syncState.source });
  return claimed.length > 0;
}

async function releaseLease() {
  try {
    await db().update(syncState).set({ leaseUntil: null }).where(eq(syncState.source, OUTLOOK));
  } catch {
    // The lease expires by itself.
  }
}

// Pulls a fixed window of the primary calendar and makes the stored copy match it. Re-running
// never duplicates rows, and events deleted or moved in Outlook disappear here too.
export async function syncOutlook(): Promise<SyncResult> {
  const conn = await getConnection();
  if (!conn) return null;
  if (!(await claimLease())) return { skipped: true };
  try {
    const tokens = await refreshTokens(decrypt(conn.refreshTokenEnc));

    // Rotate the stored token only if the connection is still the one we started with. If the
    // owner disconnected or reconnected meanwhile, abandon this run instead of resurrecting it.
    let current = conn.refreshTokenEnc;
    if (tokens.refresh_token) {
      const next = encrypt(tokens.refresh_token);
      const updated = await db()
        .update(connections)
        .set({ refreshTokenEnc: next, updatedAt: new Date() })
        .where(and(eq(connections.provider, OUTLOOK), eq(connections.refreshTokenEnc, conn.refreshTokenEnc)))
        .returning({ provider: connections.provider });
      if (updated.length === 0) return null;
      current = next;
    }

    const today = ymd(new Date());
    const from = startOfDay(addDays(today, -30));
    const to = startOfDay(addDays(today, 366));
    const qs = new URLSearchParams({
      startDateTime: from.toISOString(),
      endDateTime: to.toISOString(),
      $select: "id,subject,start,end,isAllDay,isCancelled,location",
      $top: "100",
    });

    const calendars = await listCalendars(tokens.access_token);
    // Without the calendar list only the main calendar is read, so nothing may be deleted.
    const partial = !calendars;
    const targets = calendars ?? [{ id: null, kind: "event" as EventKind }];

    const rows = new Map<string, EventRow>();
    const unreadable = new Set<string>();
    let unreadableCount = 0;
    let pages = 0;
    for (const target of targets) {
      const base = target.id ? `${GRAPH}/me/calendars/${encodeURIComponent(target.id)}/calendarView` : `${GRAPH}/me/calendarView`;
      let next: string | undefined = `${base}?${qs}`;
      while (next) {
        if (++pages > MAX_PAGES) throw new Error("calendar too large to sync");
        const body = Page.parse(await graphGet(next, tokens.access_token));
        for (const raw of body.value) {
          const mapped = toRow(raw, startOfDay, target.kind);
          if (mapped.kind === "row") rows.set(mapped.row.sourceId, mapped.row);
          else if (mapped.kind === "invalid") {
            unreadableCount++;
            if (mapped.id) unreadable.add(mapped.id);
          }
        }
        next = body["@odata.nextLink"];
      }
    }
    if (unreadableCount) console.error(`outlook: ${unreadableCount} event(s) could not be read and were left as they were`);

    const list = [...rows.values()];
    const keep = [...rows.keys(), ...unreadable];
    let keptOnEmpty = false;

    // The writes happen under a share lock on the connection row, so a Disconnect has to wait
    // for them to finish and then removes everything, and a changed connection cancels them.
    const wrote = await db().transaction(async (tx) => {
      const [live] = await tx
        .select({ enc: connections.refreshTokenEnc })
        .from(connections)
        .where(eq(connections.provider, OUTLOOK))
        .for("share");
      if (!live || live.enc !== current) return false;

      for (let i = 0; i < list.length; i += 500) {
        await tx
          .insert(events)
          .values(list.slice(i, i + 500))
          .onConflictDoUpdate({
            target: [events.source, events.sourceId],
            set: { ts: sql`excluded.ts`, payload: sql`excluded.payload` },
          });
      }

      const inWindow = and(eq(events.source, OUTLOOK), gte(events.ts, from), lt(events.ts, to));
      // An empty answer for a calendar that had events is more likely a bad response than a
      // cleared calendar, so keep the stored copy and say so.
      if (partial) return true;
      if (keep.length === 0) {
        const [stored] = await tx.select({ n: count() }).from(events).where(inWindow);
        if ((stored?.n ?? 0) > 3) {
          keptOnEmpty = true;
          return true;
        }
      }
      await tx.delete(events).where(and(inWindow, keep.length ? notInArray(events.sourceId, keep) : undefined));
      return true;
    });
    if (!wrote) return null;

    await recordState({
      lastOkAt: new Date(),
      lastError: keptOnEmpty ? "Outlook returned no events, so the existing copy was kept." : null,
    });
    return { events: list.length };
  } catch (e) {
    const expired = e instanceof TokenError && e.code === "invalid_grant";
    console.error("outlook: sync failed", e instanceof Error ? e.message : "unknown error");
    await recordState({ lastError: expired ? EXPIRED : "Sync failed. It will retry." }).catch(() => {});
    throw e;
  } finally {
    await releaseLease();
  }
}

// Called after a page renders, so opening the app keeps the calendar fresh without delaying it.
export async function syncOutlookIfStale() {
  try {
    if (!(await getConnection())) return;
    const state = await getSyncState();
    if (state?.lastError === EXPIRED) return; // needs the owner to reconnect; retrying cannot help
    const now = Date.now();
    if (now - (state?.lastOkAt?.getTime() ?? 0) < FRESH_MS) return;
    if (now - (state?.cursor ? Date.parse(state.cursor) || 0 : 0) < RETRY_MS) return;
    await syncOutlook();
  } catch {
    // Recorded in sync_state; the Settings page shows it.
  }
}
