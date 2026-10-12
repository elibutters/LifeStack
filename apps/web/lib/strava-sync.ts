import "server-only";
import { and, count, eq, gte, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { connections, events, syncState } from "@lifestack/db";
import { decrypt, encrypt } from "./crypto";
import { db } from "./db";
import { describeError } from "./errors";
import { createSubscription, listSubscriptions, refreshTokens, StravaError, stravaGet, webhookUrl } from "./strava";
import { STRAVA, toRow, type ActivityRow } from "./strava-map";

const FRESH_MS = 60 * 60 * 1000; // sync on open if the last success is older than this
const RETRY_MS = 5 * 60 * 1000; // never more often than this, even after a failure
const OVERLAP_S = 14 * 24 * 60 * 60; // re-read the last two weeks each time, so edits and deletions are picked up
const PER_PAGE = 200;
const MAX_PAGES = 30;
const EXPIRED = "Strava sign-in expired. Reconnect Strava.";

export type SyncResult = { activities: number } | { skipped: true } | null;

// sync_state.cursor holds JSON: the newest activity start seen (epoch seconds), the athlete id, and the last attempt.
type Cursor = { after?: number; athlete?: number; tried?: string };
const readCursor = (raw: string | null | undefined): Cursor => {
  try {
    const v = raw ? (JSON.parse(raw) as Cursor) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
};

export async function getConnection() {
  const [row] = await db().select().from(connections).where(eq(connections.provider, STRAVA));
  return row ?? null;
}

export async function getSyncState() {
  const [row] = await db().select().from(syncState).where(eq(syncState.source, STRAVA));
  return row ?? null;
}

async function recordState(set: { lastOkAt?: Date; lastError?: string | null; cursor?: string }) {
  await db()
    .insert(syncState)
    .values({ source: STRAVA, ...set })
    .onConflictDoUpdate({ target: syncState.source, set });
}

async function patchCursor(patch: Cursor) {
  const cur = readCursor((await getSyncState())?.cursor);
  await recordState({ cursor: JSON.stringify({ ...cur, ...patch }) });
}

export async function saveConnection(refreshToken: string, account: string | null, athleteId: number) {
  const row = { provider: STRAVA, account, refreshTokenEnc: encrypt(refreshToken), updatedAt: new Date() };
  await db().insert(connections).values(row).onConflictDoUpdate({ target: connections.provider, set: row });
  const cur = readCursor((await getSyncState())?.cursor);
  // The same athlete reconnecting keeps their progress; a different one starts over.
  await recordState({ cursor: JSON.stringify({ athlete: athleteId, after: cur.athlete === athleteId ? cur.after : 0 }), lastError: null });
}

export async function stravaActivityCount(): Promise<number> {
  const [row] = await db().select({ n: count() }).from(events).where(eq(events.source, STRAVA));
  return row?.n ?? 0;
}

export async function disconnectStrava() {
  // Deleting the connection first also makes any sync that is mid-flight abandon its writes.
  await db().delete(connections).where(eq(connections.provider, STRAVA));
  await db().delete(syncState).where(eq(syncState.source, STRAVA));
  await db().delete(events).where(eq(events.source, STRAVA));
}

// Only one sync runs at a time. The lease expires on its own if a run is killed mid-way.
async function claimLease(): Promise<boolean> {
  await db().insert(syncState).values({ source: STRAVA }).onConflictDoNothing();
  const claimed = await db()
    .update(syncState)
    .set({ leaseUntil: sql`now() + interval '5 minutes'` })
    .where(and(eq(syncState.source, STRAVA), sql`(${syncState.leaseUntil} is null or ${syncState.leaseUntil} < now())`))
    .returning({ source: syncState.source });
  return claimed.length > 0;
}

async function releaseLease() {
  try {
    await db().update(syncState).set({ leaseUntil: null }).where(eq(syncState.source, STRAVA));
  } catch {
    // The lease expires by itself.
  }
}

const List = z.array(z.unknown());

// Pulls activities since the last run (minus two weeks) and makes the stored copy match: re-running never duplicates
// rows, and activities deleted or edited on Strava change here too. `full` re-reads the whole history.
export async function syncStrava(opts: { full?: boolean } = {}): Promise<SyncResult> {
  const conn = await getConnection();
  if (!conn) return null;
  if (!(await claimLease())) return { skipped: true };
  try {
    await patchCursor({ tried: new Date().toISOString() });
    const tokens = await refreshTokens(decrypt(conn.refreshTokenEnc));

    // Strava can hand out a new refresh token each time: store it, but only if the connection is still the one we
    // started with, so a Disconnect or reconnect mid-run is not undone.
    const next = encrypt(tokens.refresh_token);
    const updated = await db()
      .update(connections)
      .set({ refreshTokenEnc: next, updatedAt: new Date() })
      .where(and(eq(connections.provider, STRAVA), eq(connections.refreshTokenEnc, conn.refreshTokenEnc)))
      .returning({ provider: connections.provider });
    if (updated.length === 0) return null;

    const cur = readCursor((await getSyncState())?.cursor);
    const afterEpoch = opts.full ? 0 : Math.max(0, (cur.after ?? 0) - OVERLAP_S);

    const rows = new Map<string, ActivityRow>();
    const unreadable = new Set<string>();
    let partial = false;
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) {
        partial = true; // more than we are willing to read in one run: store what we have, delete nothing
        break;
      }
      const list = List.parse(await stravaGet("/athlete/activities", tokens.access_token, { after: afterEpoch, per_page: PER_PAGE, page }));
      for (const raw of list) {
        const mapped = toRow(raw);
        if (mapped.kind === "row") rows.set(mapped.row.sourceId, mapped.row);
        else if (mapped.id != null) unreadable.add(`act:${mapped.id}`);
      }
      if (list.length < PER_PAGE) break;
    }
    if (unreadable.size) console.error(`strava: ${unreadable.size} activity(ies) could not be read and were left as they were`);

    const list = [...rows.values()];
    const keep = [...rows.keys(), ...unreadable];
    const from = new Date(afterEpoch * 1000);
    let keptOnEmpty = false;

    const wrote = await db().transaction(async (tx) => {
      const [live] = await tx.select({ enc: connections.refreshTokenEnc }).from(connections).where(eq(connections.provider, STRAVA)).for("share");
      if (!live || live.enc !== next) return false;
      for (let i = 0; i < list.length; i += 500) {
        await tx
          .insert(events)
          .values(list.slice(i, i + 500))
          .onConflictDoUpdate({
            target: [events.source, events.sourceId],
            set: { ts: sql`excluded.ts`, valueNum: sql`excluded.value_num`, valueText: sql`excluded.value_text`, payload: sql`excluded.payload` },
          });
      }
      if (partial) return true;
      const inWindow = and(eq(events.source, STRAVA), gte(events.ts, from));
      // An empty answer for a window that had activities is more likely a bad response than a cleared account.
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

    const newest = list.reduce((m, r) => Math.max(m, Math.floor(r.ts.getTime() / 1000)), cur.after ?? 0);
    await recordState({
      lastOkAt: new Date(),
      lastError: keptOnEmpty ? "Strava returned no activities, so the existing copy was kept." : null,
      cursor: JSON.stringify({ ...cur, after: newest, tried: new Date().toISOString() }),
    });
    return { activities: list.length };
  } catch (e) {
    const err = e instanceof StravaError ? e : null;
    const message = err?.unauthorized ? EXPIRED : err?.rateLimited ? "Strava rate limit reached. It will retry." : "Sync failed. It will retry.";
    console.error("strava: sync failed", describeError(e));
    await recordState({ lastError: message }).catch(() => {});
    throw e;
  } finally {
    await releaseLease();
  }
}

// Called after a page renders, so opening the app keeps activities fresh without delaying it.
export async function syncStravaIfStale() {
  try {
    if (!(await getConnection())) return;
    const state = await getSyncState();
    if (state?.lastError === EXPIRED) return; // needs the owner to reconnect; retrying cannot help
    const now = Date.now();
    if (now - (state?.lastOkAt?.getTime() ?? 0) < FRESH_MS) return;
    if (now - (Date.parse(readCursor(state?.cursor).tried ?? "") || 0) < RETRY_MS) return;
    await syncStrava();
  } catch {
    // Recorded in sync_state; the Connections page shows it.
  }
}

// Strava pushes an event when an activity is created, changed or deleted. Events are not signed, so nothing in one is
// trusted: a matching event only triggers the same incremental sync, which reads the truth from Strava with our token.
export async function handleStravaEvent(event: { object_type?: string; aspect_type?: string; owner_id?: number; updates?: Record<string, unknown> }): Promise<"ignored" | "disconnected" | "sync"> {
  const conn = await getConnection();
  if (!conn) return "ignored";
  const state = await getSyncState();
  const cur = readCursor(state?.cursor);
  if (!cur.athlete || event.owner_id !== cur.athlete) return "ignored";
  if (event.object_type === "athlete") {
    if (event.updates?.authorized === "false") {
      await disconnectStrava(); // the athlete revoked access on Strava
      return "disconnected";
    }
    return "ignored";
  }
  if (event.object_type !== "activity") return "ignored";
  if (Date.now() - (Date.parse(cur.tried ?? "") || 0) < 20_000) return "ignored"; // a burst of events is one sync
  await syncStrava();
  return "sync";
}

// Registers Strava's live updates for this deployment, once. Strava allows one subscription per application and only
// calls public https addresses, so a local or unconfigured deployment skips it.
export async function ensureWebhook(origin: string): Promise<"ok" | "created" | "skipped" | "other"> {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.hostname === "localhost") return "skipped";
  const subs = await listSubscriptions();
  if (subs.some((s) => s.callback_url === webhookUrl(origin))) return "ok";
  if (subs.length > 0) return "other";
  await createSubscription(origin);
  return "created";
}
