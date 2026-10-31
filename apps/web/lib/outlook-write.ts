import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { connections } from "@lifestack/db";
import { decrypt, encrypt } from "./crypto";
import { db } from "./db";
import { describeError } from "./errors";
import { GRAPH, GraphError, graphSend, refreshTokens, TokenError, WRITE_SCOPES } from "./microsoft";

// Putting goal sessions on the owner's own Outlook calendar. Every event carries the "Life Stack" category (colour it in Outlook to
// see them at a glance) and is created idempotently, so a retry never double-books. Nothing here ever touches an event it did not create.
export const CATEGORY = "Life Stack";
export const NEEDS_WRITE = "Reconnect Outlook on the Connections page to let Life Stack add calendar events.";

export type SessionEvent = { key: string; title: string; start: Date; end: Date; body?: string; reminderMin?: number };

// Graph wants a GUID to treat a repeated create as the same request; one derived from the session's key is stable across retries.
export function transactionId(key: string): string {
  const h = createHash("sha256").update(`life-stack-session:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const utc = (d: Date) => ({ dateTime: d.toISOString().slice(0, 19), timeZone: "UTC" });

export function eventPayload(s: SessionEvent) {
  return {
    subject: s.title.slice(0, 200),
    body: { contentType: "text", content: (s.body ?? "").slice(0, 4000) },
    start: utc(s.start),
    end: utc(s.end),
    categories: [CATEGORY],
    isReminderOn: true,
    reminderMinutesBeforeStart: s.reminderMin ?? 15,
    showAs: "busy",
    transactionId: transactionId(s.key),
  };
}

// Only what changed, so moving a session never rewrites its notes.
export function eventPatch(p: Partial<Pick<SessionEvent, "title" | "start" | "end" | "body">>) {
  return {
    ...(p.title !== undefined ? { subject: p.title.slice(0, 200) } : {}),
    ...(p.body !== undefined ? { body: { contentType: "text", content: p.body.slice(0, 4000) } } : {}),
    ...(p.start ? { start: utc(p.start) } : {}),
    ...(p.end ? { end: utc(p.end) } : {}),
  };
}

export type WriteResult<T> = { ok: true; value: T } | { ok: false; reason: "not_connected" | "needs_reconnect" | "failed" };

// One access token with write access, rotating the stored refresh token the same careful way the syncs do.
async function withWriteToken<T>(fn: (token: string) => Promise<T>): Promise<WriteResult<T>> {
  const [conn] = await db().select().from(connections).where(eq(connections.provider, "outlook"));
  if (!conn) return { ok: false, reason: "not_connected" };
  let tokens;
  try {
    tokens = await refreshTokens(decrypt(conn.refreshTokenEnc), WRITE_SCOPES);
  } catch (e) {
    if (e instanceof TokenError) return { ok: false, reason: "needs_reconnect" }; // never approved writing, or sign-in expired
    throw e;
  }
  if (tokens.refresh_token) {
    const swapped = await db()
      .update(connections)
      .set({ refreshTokenEnc: encrypt(tokens.refresh_token), updatedAt: new Date() })
      .where(and(eq(connections.provider, "outlook"), eq(connections.refreshTokenEnc, conn.refreshTokenEnc)))
      .returning({ p: connections.provider });
    if (swapped.length === 0) return { ok: false, reason: "not_connected" }; // disconnected or reconnected meanwhile
  }
  try {
    return { ok: true, value: await fn(tokens.access_token) };
  } catch (e) {
    if (e instanceof GraphError && (e.status === 401 || e.status === 403)) return { ok: false, reason: "needs_reconnect" };
    console.error("outlook: calendar write failed", describeError(e));
    return { ok: false, reason: "failed" };
  }
}

const Id = (v: unknown): string => {
  const id = (v as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || !id) throw new Error("Graph returned no event id");
  return id;
};

// Creates the events and returns each one's Outlook id, keyed by the session key. Stops at the first failure and says which were made.
export async function createEvents(events: SessionEvent[]): Promise<WriteResult<{ key: string; id: string }[]>> {
  const made: { key: string; id: string }[] = [];
  const r = await withWriteToken(async (token) => {
    for (const e of events) {
      made.push({ key: e.key, id: Id(await graphSend("POST", `${GRAPH}/me/events`, token, eventPayload(e))) });
    }
    return made;
  });
  return r;
}

export const updateEvent = (id: string, patch: Parameters<typeof eventPatch>[0]) =>
  withWriteToken(async (token) => {
    await graphSend("PATCH", `${GRAPH}/me/events/${encodeURIComponent(id)}`, token, eventPatch(patch));
    return true as const;
  });

// Deleting something already gone is a success: the goal is only that it is not on the calendar.
export const deleteEvent = (id: string) =>
  withWriteToken(async (token) => {
    try {
      await graphSend("DELETE", `${GRAPH}/me/events/${encodeURIComponent(id)}`, token);
    } catch (e) {
      if (!(e instanceof GraphError && e.status === 404)) throw e;
    }
    return true as const;
  });

// Rewrites the body of several events on one access token (an event the owner deleted in Outlook counts as done: there is nothing to
// update). Stops when `deadline` (epoch ms) passes. Returns which ids were done and how many failed for another reason.
export const updateBodies = (items: { id: string; body: string }[], deadline: number) =>
  withWriteToken(async (token) => {
    const done: string[] = [];
    let failed = 0;
    for (const it of items) {
      if (Date.now() > deadline) break;
      try {
        await graphSend("PATCH", `${GRAPH}/me/events/${encodeURIComponent(it.id)}`, token, eventPatch({ body: it.body }));
        done.push(it.id);
      } catch (e) {
        if (!(e instanceof GraphError)) throw e;
        if (e.status === 404) done.push(it.id);
        else if (e.status === 401 || e.status === 403) throw e;
        else failed++;
      }
    }
    return { done, failed };
  });
