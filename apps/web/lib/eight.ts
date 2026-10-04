import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { connections, events, syncState } from "@lifestack/db";
import { decrypt, encrypt } from "./crypto";
import { db } from "./db";
import { addDays, startOfDay, TZ, ymd } from "./dates";
import { describeError } from "./errors";
import { EIGHT, rowsFromDay, SleepDay, hasSleep } from "./eight-map";

export { EIGHT };

const AUTH_URL = "https://auth-api.8slp.net/v1/tokens";
const API = "https://client-api.8slp.net/v1";
// Public OAuth client from the Eight Sleep Android app, not a user secret. Requests without it are rejected.
const CLIENT_ID = "0894c7f33bb94800a03f1f4df13a4f38";
const CLIENT_SECRET = "f0954a3ed5763ba3d06834c73731a32f15f168f47d4f164751275def86db0c76";
const USER_AGENT = "okhttp/4.9.3";

const FRESH_MS = 15 * 60 * 1000;
const RETRY_MS = 2 * 60 * 1000;
const BUDGET_MS = 45_000;
const RECENT_DAYS = 14;
const CHUNK_DAYS = 45;
const FLOOR = "2018-01-01";
const AUTH_FAILED =
  "Could not sign in to Eight Sleep. Check the email and password. Accounts with two-factor authentication are not supported.";

const Creds = z.object({ email: z.string().min(3), password: z.string().min(1) });
const Cursor = z.object({
  backfillBefore: z.string().nullable().optional(),
  emptyStreak: z.number().int().nonnegative().optional(),
});
const Auth = z.object({ access_token: z.string().min(1), userId: z.string().min(1), expires_in: z.number().optional() });
const Trends = z.object({
  days: z.array(z.unknown()).optional(),
  result: z.object({ days: z.array(z.unknown()).optional() }).optional(),
});

export class EightError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "EightError";
    this.status = status;
  }
}

export async function getEightConnection() {
  const [row] = await db().select().from(connections).where(eq(connections.provider, EIGHT));
  return row ?? null;
}

export async function getEightSyncState() {
  const [row] = await db().select().from(syncState).where(eq(syncState.source, EIGHT));
  return row ?? null;
}

export async function disconnectEight() {
  await db().delete(connections).where(eq(connections.provider, EIGHT));
  await db().delete(syncState).where(eq(syncState.source, EIGHT));
  await db().delete(events).where(eq(events.source, EIGHT));
}

export async function saveEightConnection(email: string, password: string) {
  await authenticate(email, password);
  const row = {
    provider: EIGHT,
    account: email,
    refreshTokenEnc: encrypt(JSON.stringify({ email, password })),
    updatedAt: new Date(),
  };
  await db()
    .insert(connections)
    .values(row)
    .onConflictDoUpdate({ target: connections.provider, set: row });
}

function readCreds(enc: string) {
  return Creds.parse(JSON.parse(decrypt(enc)));
}

async function authenticate(email: string, password: string): Promise<{ token: string; userId: string }> {
  const body = new URLSearchParams({
    grant_type: "password",
    username: email,
    password,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT, Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new EightError(AUTH_FAILED, res.status);
  const data = Auth.safeParse(await res.json());
  if (!data.success) throw new EightError(AUTH_FAILED);
  return { token: data.data.access_token, userId: data.data.userId };
}

async function apiGet(
  token: string,
  userId: string,
  path: string,
  params: Record<string, string>,
  email: string,
  password: string,
): Promise<unknown> {
  const url = new URL(`${API}${path.replace("{userId}", userId)}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = (t: string) => ({ Authorization: `Bearer ${t}`, "User-Agent": USER_AGENT, Accept: "application/json" });
  let res = await fetch(url, { headers: headers(token), signal: AbortSignal.timeout(25_000) });
  if (res.status === 401) {
    const next = await authenticate(email, password);
    token = next.token;
    res = await fetch(url, { headers: headers(token), signal: AbortSignal.timeout(25_000) });
  }
  if (res.status === 429) throw new EightError("Eight Sleep rate-limited the sync. It will retry.", 429);
  if (!res.ok) throw new EightError(`Eight Sleep request failed (${res.status}).`, res.status);
  return res.json();
}

async function trends(token: string, userId: string, from: string, to: string, email: string, password: string) {
  const raw = await apiGet(
    token,
    userId,
    "/users/{userId}/trends",
    {
      tz: TZ,
      from,
      to,
      "include-main": "false",
      "include-all-sessions": "true",
      "model-version": "v2",
    },
    email,
    password,
  );
  const parsed = Trends.parse(raw);
  const days = parsed.days ?? parsed.result?.days ?? [];
  return days.flatMap((d) => {
    const one = SleepDay.safeParse(d);
    return one.success && hasSleep(one.data) ? [one.data] : [];
  });
}

async function recordState(set: { lastOkAt?: Date; lastError?: string | null; cursor?: string }) {
  await db()
    .insert(syncState)
    .values({ source: EIGHT, ...set })
    .onConflictDoUpdate({ target: syncState.source, set });
}

async function claimLease(): Promise<boolean> {
  await db().insert(syncState).values({ source: EIGHT }).onConflictDoNothing();
  const claimed = await db()
    .update(syncState)
    .set({ leaseUntil: sql`now() + interval '90 seconds'` })
    .where(and(eq(syncState.source, EIGHT), sql`(${syncState.leaseUntil} is null or ${syncState.leaseUntil} < now())`))
    .returning({ source: syncState.source });
  return claimed.length > 0;
}

async function releaseLease() {
  try {
    await db().update(syncState).set({ leaseUntil: null }).where(eq(syncState.source, EIGHT));
  } catch {
    // The lease expires by itself.
  }
}

function parseCursor(raw: string | null | undefined): { kind: "fresh" | "backfill" | "done"; before?: string; emptyStreak: number } {
  if (!raw) return { kind: "fresh", emptyStreak: 0 };
  try {
    const parsed = Cursor.safeParse(JSON.parse(raw));
    if (!parsed.success) return { kind: "fresh", emptyStreak: 0 };
    if (parsed.data.backfillBefore === undefined) return { kind: "fresh", emptyStreak: parsed.data.emptyStreak ?? 0 };
    if (parsed.data.backfillBefore === null) return { kind: "done", emptyStreak: 0 };
    return { kind: "backfill", before: parsed.data.backfillBefore, emptyStreak: parsed.data.emptyStreak ?? 0 };
  } catch {
    return { kind: "fresh", emptyStreak: 0 };
  }
}

async function writeDays(days: z.infer<typeof SleepDay>[]) {
  const rows = days.flatMap((d) => rowsFromDay(d, startOfDay));
  if (rows.length === 0) return 0;
  const unique = [...new Map(rows.map((r) => [r.sourceId, r])).values()];
  await db().transaction(async (tx) => {
    const [live] = await tx
      .select({ provider: connections.provider })
      .from(connections)
      .where(eq(connections.provider, EIGHT))
      .for("share");
    if (!live) return;
    for (let i = 0; i < unique.length; i += 500) {
      await tx
        .insert(events)
        .values(unique.slice(i, i + 500))
        .onConflictDoUpdate({
          target: [events.source, events.sourceId],
          set: { ts: sql`excluded.ts`, valueNum: sql`excluded.value_num`, payload: sql`excluded.payload` },
        });
    }
  });
  return unique.length;
}

export type EightSyncResult = { nights: number; backfill: boolean } | { skipped: true } | null;

export async function syncEight(): Promise<EightSyncResult> {
  const conn = await getEightConnection();
  if (!conn) return null;
  if (!(await claimLease())) return { skipped: true };
  const started = Date.now();
  try {
    const creds = readCreds(conn.refreshTokenEnc);
    const { token, userId } = await authenticate(creds.email, creds.password);
    const state = await getEightSyncState();
    const cursor = parseCursor(state?.cursor);
    const today = ymd(new Date());
    const recentFrom = addDays(today, -RECENT_DAYS);
    let nights = await writeDays(await trends(token, userId, recentFrom, today, creds.email, creds.password));

    let backfillBefore: string | null = cursor.kind === "done" ? null : cursor.kind === "backfill" ? cursor.before! : recentFrom;
    let emptyStreak = cursor.emptyStreak;
    let backfill = backfillBefore != null && backfillBefore > FLOOR;

    while (backfill && backfillBefore && Date.now() - started < BUDGET_MS) {
      const to = addDays(backfillBefore, -1);
      if (to < FLOOR) {
        backfillBefore = null;
        backfill = false;
        break;
      }
      const from = addDays(to, -(CHUNK_DAYS - 1));
      const start = from < FLOOR ? FLOOR : from;
      const days = await trends(token, userId, start, to, creds.email, creds.password);
      nights += await writeDays(days);
      emptyStreak = days.length === 0 ? emptyStreak + 1 : 0;
      backfillBefore = start;
      if (start <= FLOOR || emptyStreak >= 2) {
        backfillBefore = null;
        backfill = false;
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    await recordState({
      lastOkAt: new Date(),
      lastError: null,
      cursor: JSON.stringify({ backfillBefore, emptyStreak: backfill ? emptyStreak : 0 }),
    });
    return { nights, backfill: backfillBefore != null };
  } catch (e) {
    const auth = e instanceof EightError && (e.status === 401 || e.status === 403 || e.message === AUTH_FAILED);
    console.error("eight: sync failed", describeError(e));
    await recordState({
      lastError: auth ? AUTH_FAILED : e instanceof EightError ? e.message : "Sync failed. It will retry.",
    }).catch(() => {});
    throw e;
  } finally {
    await releaseLease();
  }
}

export async function syncEightIfStale() {
  try {
    if (!(await getEightConnection())) return;
    const state = await getEightSyncState();
    if (state?.lastError === AUTH_FAILED) return;
    const now = Date.now();
    const cursor = parseCursor(state?.cursor);
    if (cursor.kind === "done" && now - (state?.lastOkAt?.getTime() ?? 0) < FRESH_MS) return;
    if (state?.lastError && now - (state.lastOkAt?.getTime() ?? 0) < RETRY_MS) return;
    await syncEight();
  } catch {
    // Recorded in sync_state.
  }
}
