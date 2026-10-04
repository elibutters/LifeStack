import "server-only";
import { and, count, eq, gt, lt } from "drizzle-orm";
import { authAttempts } from "@lifestack/db";
import { db } from "./db";
import { safeEqual, sessionKey } from "./session";

// Password checking with a database-backed attempt limit, shared by the web form and the app's login
// endpoint so both are throttled the same way.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 5;
// High enough that a stranger cannot cheaply lock the owner out, low enough to make
// guessing a long passphrase from many addresses pointless.
const MAX_GLOBAL = 300;

export function clientIp(h: Headers): string {
  // Vercel sets these itself, so a client cannot spoof them there.
  return h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export type PasswordCheck = { ok: true; key: string } | { ok: false; reason: "not_configured" | "unavailable" | "throttled" | "wrong" };

export async function checkPassword(ip: string, given: string): Promise<PasswordCheck> {
  const key = sessionKey();
  if (!key) return { ok: false, reason: "not_configured" };
  const since = new Date(Date.now() - WINDOW_MS);

  // Attempts are counted in the database because serverless instances share no memory.
  // The attempt is recorded before it is counted, so a burst of parallel requests
  // cannot all read a zero count. If the database is unreachable, sign-in fails closed.
  let attemptId: number, fromIp: number, total: number;
  try {
    const [row] = await db().insert(authAttempts).values({ ip }).returning({ id: authAttempts.id });
    attemptId = row!.id;
    const [[a], [b]] = await Promise.all([
      db().select({ n: count() }).from(authAttempts).where(and(eq(authAttempts.ip, ip), gt(authAttempts.ts, since))),
      db().select({ n: count() }).from(authAttempts).where(gt(authAttempts.ts, since)),
    ]);
    fromIp = a?.n ?? 0;
    total = b?.n ?? 0;
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (fromIp > MAX_PER_IP || total > MAX_GLOBAL) return { ok: false, reason: "throttled" };

  if (!(await safeEqual(given, process.env.APP_PASSWORD!, key))) {
    await db().delete(authAttempts).where(lt(authAttempts.ts, new Date(Date.now() - 24 * 60 * 60 * 1000)));
    return { ok: false, reason: "wrong" };
  }
  // A successful sign-in does not count against the limit.
  await db().delete(authAttempts).where(eq(authAttempts.id, attemptId));
  return { ok: true, key };
}
