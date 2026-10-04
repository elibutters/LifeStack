"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkPassword, clientIp } from "@/lib/login-guard";
import { createSession, SESSION_COOKIE, SESSION_TTL_S } from "@/lib/session";

const MESSAGES = {
  not_configured: "Sign-in is not configured. Set APP_PASSWORD (16+ chars) and SESSION_SECRET (32+ chars).",
  unavailable: "Sign-in is unavailable right now. Try again shortly.",
  throttled: "Too many attempts. Try again in 15 minutes.",
  wrong: "Wrong email or password.",
} as const;

export async function login(_prev: string | null, form: FormData): Promise<string | null> {
  const result = await checkPassword(clientIp(await headers()), String(form.get("email") ?? ""), String(form.get("password") ?? ""));
  if (!result.ok) return MESSAGES[result.reason];

  (await cookies()).set(SESSION_COOKIE, await createSession(result.key, result.userId ?? 0), {
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
