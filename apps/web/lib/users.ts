import "server-only";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { apiTokens, users } from "@lifestack/db";
import { db } from "./db";
import { hashPassword } from "./passwords";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const validEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export async function findUserByEmail(email: string) {
  const [row] = await db().select().from(users).where(eq(users.email, normalizeEmail(email)));
  return row ?? null;
}

export async function userCount(): Promise<number> {
  const [row] = await db().select({ n: count() }).from(users);
  return row?.n ?? 0;
}

export async function createUser(email: string, password: string) {
  const [row] = await db().insert(users).values({ email: normalizeEmail(email), passwordHash: await hashPassword(password) }).returning();
  return row!;
}

// The first sign-in with OWNER_EMAIL and APP_PASSWORD creates the owner's account (the password is stored
// hashed from then on). Keys made before accounts existed are handed to the owner.
export async function createOwner(email: string, password: string) {
  const owner = await createUser(email, password);
  await db().update(apiTokens).set({ userId: owner.id }).where(isNull(apiTokens.userId));
  return owner;
}

export const MIN_PASSWORD = 12;

export async function findUserById(id: number) {
  const [row] = await db().select().from(users).where(eq(users.id, id));
  return row ?? null;
}

// Replaces the password and cancels the phone's keys, so a lost phone stops working. Keys made for shortcuts and
// agents are left alone: they are revoked one by one on the API keys page.
export async function changePassword(userId: number, password: string) {
  await db().update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, userId));
  await db().update(apiTokens).set({ revokedAt: sql`now()` }).where(and(eq(apiTokens.userId, userId), eq(apiTokens.kind, "app"), isNull(apiTokens.revokedAt)));
}

export async function changeEmail(userId: number, email: string): Promise<"ok" | "invalid" | "taken"> {
  const clean = normalizeEmail(email);
  if (!validEmail(clean)) return "invalid";
  const other = await findUserByEmail(clean);
  if (other && other.id !== userId) return "taken";
  await db().update(users).set({ email: clean }).where(eq(users.id, userId));
  return "ok";
}
