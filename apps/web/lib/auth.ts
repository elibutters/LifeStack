import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, sessionKey, sessionUserId, verifySession } from "./session";

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

// The signed-in user's id, or null for a deployment with no accounts (the original password-only owner).
export async function currentUserId(): Promise<number | null> {
  const key = sessionKey();
  if (!key) return null;
  const id = await sessionUserId((await cookies()).get(SESSION_COOKIE)?.value, key);
  return id ? id : null;
}
