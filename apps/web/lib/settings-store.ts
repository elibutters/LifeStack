import "server-only";
import { eq } from "drizzle-orm";
import { settings } from "@lifestack/db";
import { db } from "./db";
import { resolveAll, valueOf, type EmailRulesT } from "./settings-core";

// Reads and writes the settings table. No rules live here (see settings-core.ts), and nothing here imports other features,
// so any module can read a setting without creating an import cycle.
export async function loadOverrides(): Promise<Record<string, { value: unknown; updatedAt: Date }>> {
  const rows = await db().select().from(settings);
  return Object.fromEntries(rows.map((r) => [r.key, { value: r.value, updatedAt: r.updatedAt }]));
}

export async function putSetting(key: string, value: unknown) {
  await db().insert(settings).values({ key, value, updatedAt: new Date() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export async function deleteSetting(key: string) {
  await db().delete(settings).where(eq(settings.key, key));
}

export async function loadEmailRules(): Promise<EmailRulesT> {
  return valueOf(resolveAll(await loadOverrides()), "email.rules");
}
