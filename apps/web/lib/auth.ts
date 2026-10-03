import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, sessionKey, verifySession } from "./session";

export async function isAuthed(): Promise<boolean> {
  const key = sessionKey();
  if (!key) return false;
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value, key);
}

// The proxy already gates requests, but server actions are POSTs to whatever page
// renders them, including public ones. Every page, server action and route handler
// that touches data calls this (or checks a bearer token) itself.
export async function requireSession(): Promise<void> {
  if (!(await isAuthed())) redirect("/login");
}
