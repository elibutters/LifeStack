"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, safeEqual, SESSION_COOKIE, SESSION_TTL_S } from "@/lib/session";

export async function login(_prev: string | null, form: FormData): Promise<string | null> {
  const password = process.env.APP_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!password || !secret) return "APP_PASSWORD and SESSION_SECRET are not configured.";

  const given = String(form.get("password") ?? "");
  // Fixed delay blunts online guessing; a long random passphrase does the real work.
  await new Promise((r) => setTimeout(r, 500));
  if (!(await safeEqual(given, password, secret))) return "Wrong password.";

  (await cookies()).set(SESSION_COOKIE, await createSession(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
  redirect("/");
}
