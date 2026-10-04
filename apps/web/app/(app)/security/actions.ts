"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { currentUserId, requireSession } from "@/lib/auth";
import { checkPassword, clientIp } from "@/lib/login-guard";
import { changeEmail, changePassword, findUserById, MIN_PASSWORD } from "@/lib/users";

export type SecurityState = { error?: string; done?: string };

const WHY = { not_configured: "Sign-in is not configured.", unavailable: "Try again shortly.", throttled: "Too many attempts. Try again in 15 minutes.", wrong: "Your current password is not right." } as const;

// Both changes re-check the current password through the same throttled path as signing in.
async function confirm(form: FormData): Promise<{ ok: true; userId: number } | { ok: false; error: string }> {
  await requireSession();
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Accounts are not turned on for this deployment (set OWNER_EMAIL)." };
  const user = await findUserById(userId);
  if (!user) return { ok: false, error: "Account not found." };
  const check = await checkPassword(clientIp(await headers()), user.email, String(form.get("current") ?? ""));
  if (!check.ok) return { ok: false, error: WHY[check.reason] };
  return { ok: true, userId };
}

export async function changePasswordAction(_prev: SecurityState, form: FormData): Promise<SecurityState> {
  const next = String(form.get("next") ?? "");
  if (next.length < MIN_PASSWORD) return { error: `Use at least ${MIN_PASSWORD} characters.` };
  if (next.length > 200) return { error: "That is too long." };
  if (next !== String(form.get("again") ?? "")) return { error: "The two new passwords do not match." };
  if (next === String(form.get("current") ?? "")) return { error: "Pick a password you have not used here." };
  const c = await confirm(form);
  if (!c.ok) return { error: c.error };
  await changePassword(c.userId, next);
  revalidatePath("/security");
  return { done: "Password changed. Your phone was signed out; sign in again there." };
}

export async function changeEmailAction(_prev: SecurityState, form: FormData): Promise<SecurityState> {
  const c = await confirm(form);
  if (!c.ok) return { error: c.error };
  const result = await changeEmail(c.userId, String(form.get("email") ?? ""));
  if (result === "invalid") return { error: "That does not look like an email address." };
  if (result === "taken") return { error: "That email is already used by another account." };
  revalidatePath("/security");
  return { done: "Email changed. Use it the next time you sign in." };
}
