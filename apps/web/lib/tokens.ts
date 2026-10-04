import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { apiTokens } from "@lifestack/db";
import { db } from "./db";
import { SCOPES, type Scope } from "./capture-core";

export type TokenKind = "shortcut" | "widget" | "agent";
export const TOKEN_KINDS: TokenKind[] = ["shortcut", "widget", "agent"];
const MAX_ACTIVE = 10;
const PREFIX = "ls_";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

// The key is 256 bits of randomness, so a plain SHA-256 is enough to store it safely: there is nothing
// to brute-force. It is returned once and never stored.
export async function createToken(name: string, kind: TokenKind, scopes: Scope[]): Promise<{ token: string; id: number }> {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new Error("name is required");
  if (!scopes.length || scopes.some((s) => !SCOPES.includes(s))) throw new Error("invalid scopes");
  const [{ n }] = (await db().select({ n: count() }).from(apiTokens).where(isNull(apiTokens.revokedAt))) as [{ n: number }];
  if (n >= MAX_ACTIVE) throw new Error("too many active tokens");
  const token = PREFIX + randomBytes(32).toString("base64url");
  const [row] = await db()
    .insert(apiTokens)
    .values({ name: clean, kind, prefix: token.slice(0, PREFIX.length + 6), tokenHash: hash(token), scopes })
    .returning({ id: apiTokens.id });
  return { token, id: row!.id };
}

export type VerifiedToken = { id: number; kind: TokenKind; scopes: string[] };

// Returns the token only if it exists, is not revoked, and carries the scope (when one is asked for). A wrong, revoked or
// malformed key all look the same to the caller.
export async function verifyBearer(header: string | null, scope?: Scope): Promise<{ ok: true; token: VerifiedToken } | { ok: false; status: 401 | 403 }> {
  const m = /^Bearer (ls_[A-Za-z0-9_-]{20,80})$/.exec(header ?? "");
  if (!m) return { ok: false, status: 401 };
  const [row] = await db()
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, hash(m[1]!)), isNull(apiTokens.revokedAt)));
  if (!row) return { ok: false, status: 401 };
  if (scope && !row.scopes.includes(scope)) return { ok: false, status: 403 };
  // Remember when it was last used, at most once a minute.
  await db()
    .update(apiTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(and(eq(apiTokens.id, row.id), sql`(${apiTokens.lastUsedAt} is null or ${apiTokens.lastUsedAt} < now() - interval '1 minute')`))
    .catch(() => {});
  return { ok: true, token: { id: row.id, kind: row.kind as TokenKind, scopes: row.scopes } };
}

// Never includes the hash.
export async function listTokens() {
  return db()
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      kind: apiTokens.kind,
      prefix: apiTokens.prefix,
      scopes: apiTokens.scopes,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
      revokedAt: apiTokens.revokedAt,
    })
    .from(apiTokens)
    .orderBy(desc(apiTokens.createdAt));
}

export async function revokeToken(id: number) {
  await db().update(apiTokens).set({ revokedAt: new Date() }).where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt)));
}
