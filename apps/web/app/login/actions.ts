"use server";

import { and, count, eq, gt, lt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authAttempts } from "@lifestack/db";
import { db } from "@/lib/db";
import { createSession, safeEqual, SESSION_COOKIE, SESSION_TTL_S, sessionKey } from "@/lib/session";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 5;
const MAX_GLOBAL = 30;

export async function login(_prev: string | null, form: FormData): Promise<string | null> {
  const key = sessionKey();
  if (!key) return "Sign-in is not configured. Set APP_PASSWORD (16+ chars) and SESSION_SECRET (32+ chars).";

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const since = new Date(Date.now() - WINDOW_MS);

  // Failed attempts are counted in the database because serverless instances share no
  // memory. If the database is unreachable, sign-in fails closed.
  let fromIp: number, total: number;
  try {
    const [[a], [b]] = await Promise.all([
      db().select({ n: count() }).from(authAttempts).where(and(eq(authAttempts.ip, ip), gt(authAttempts.ts, since))),
      db().select({ n: count() }).from(authAttempts).where(gt(authAttempts.ts, since)),
    ]);
    fromIp = a?.n ?? 0;
    total = b?.n ?? 0;
  } catch {
    return "Sign-in is unavailable right now. Try again shortly.";
  }
  if (fromIp >= MAX_PER_IP || total >= MAX_GLOBAL) return "Too many attempts. Try again in 15 minutes.";

  const given = String(form.get("password") ?? "");
  if (!(await safeEqual(given, process.env.APP_PASSWORD!, key))) {
    await db().insert(authAttempts).values({ ip });
    await db().delete(authAttempts).where(lt(authAttempts.ts, new Date(Date.now() - 24 * 60 * 60 * 1000)));
    return "Wrong password.";
  }

  (await cookies()).set(SESSION_COOKIE, await createSession(key), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
  redirect("/");
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
