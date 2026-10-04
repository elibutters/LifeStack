"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { addSupplement, archiveSupplement, deleteLog, insertLog } from "@/lib/capture";
import { AGENT_SCOPES, describeEntry, EventInput, SCOPES, type Scope } from "@/lib/capture-core";
import { createToken, revokeToken, TOKEN_KINDS, type TokenKind } from "@/lib/tokens";

// Server actions are POSTs to their page, so each one checks the session itself.
export type LogResult = { ok: true; id: number; label: string } | { ok: false; error: string };

async function record(input: unknown): Promise<LogResult> {
  await requireSession();
  const parsed = EventInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That does not look right." };
  const r = await insertLog(parsed.data, "manual");
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/log", "layout");
  const row = parsed.data;
  const label = describeEntry(
    row.type === "mood" ? { key: "mood", valueNum: row.value, valueText: null } : row.type === "caffeine" ? { key: "caffeine", valueNum: row.mg ?? null, valueText: row.drink } : { key: "supplement.taken", valueNum: 1, valueText: row.name },
  );
  return { ok: true, id: r.id, label };
}

export async function logMood(value: number): Promise<LogResult> {
  return record({ type: "mood", value });
}

export async function logCaffeine(drink: string, mg?: number): Promise<LogResult> {
  return record({ type: "caffeine", drink, ...(mg != null ? { mg } : {}) });
}

export async function logSupplement(name: string): Promise<LogResult> {
  return record({ type: "supplement", name });
}

export async function undoLog(id: number): Promise<boolean> {
  await requireSession();
  const ok = await deleteLog(id);
  revalidatePath("/log", "layout");
  return ok;
}

export async function deleteEntry(id: number): Promise<void> {
  await requireSession();
  await deleteLog(id);
  revalidatePath("/log", "layout");
}

export async function addSupplementAction(name: string): Promise<boolean> {
  await requireSession();
  const ok = await addSupplement(name);
  revalidatePath("/log", "layout");
  return ok;
}

export async function archiveSupplementAction(id: number): Promise<void> {
  await requireSession();
  await archiveSupplement(id);
  revalidatePath("/log", "layout");
}

export type TokenState = { error?: string; token?: string; name?: string };

const TokenForm = z.object({
  name: z.string().trim().min(1, "Give it a name.").max(60),
  kind: z.enum(TOKEN_KINDS as [TokenKind, ...TokenKind[]]),
  access: z.enum(["write", "readwrite", "agent", "amazon"]),
});

export async function createTokenAction(_prev: TokenState, form: FormData): Promise<TokenState> {
  await requireSession();
  const parsed = TokenForm.safeParse({ name: form.get("name"), kind: form.get("kind"), access: form.get("access") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const scopes: Scope[] =
    parsed.data.access === "write"
      ? ["log:write"]
      : parsed.data.access === "agent"
        ? AGENT_SCOPES
        : parsed.data.access === "amazon"
          ? ["amazon:write"]
          : ["log:write", "log:read"];
  try {
    const { token } = await createToken(parsed.data.name, parsed.data.kind, scopes.filter((s) => SCOPES.includes(s)));
    revalidatePath("/log", "layout");
    revalidatePath("/api-keys");
    return { token, name: parsed.data.name }; // shown once; only a hash is kept
  } catch (e) {
    return { error: e instanceof Error && e.message === "too many active tokens" ? "Revoke an old token first (10 active at most)." : "Could not create the token." };
  }
}

export async function revokeTokenAction(id: number): Promise<void> {
  await requireSession();
  await revokeToken(id);
  revalidatePath("/log", "layout");
  revalidatePath("/api-keys");
}
