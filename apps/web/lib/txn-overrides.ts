import "server-only";
import { eq, sql } from "drizzle-orm";
import { txnOverrides } from "@lifestack/db";
import { db } from "./db";
import { describeError } from "./errors";
import { CATEGORY_KEYS } from "./finance-calc";

let ready = false;
async function ensureTable(): Promise<void> {
  if (ready) return;
  await db().execute(sql`
    create table if not exists public.txn_overrides (
      source_id text primary key not null,
      category text not null,
      created_at timestamptz default now() not null
    )
  `);
  ready = true;
}

export async function loadTxnOverrides(): Promise<Map<string, string>> {
  try {
    await ensureTable();
    const rows = await db().select().from(txnOverrides);
    return new Map(rows.filter((r) => CATEGORY_KEYS.includes(r.category)).map((r) => [r.sourceId, r.category]));
  } catch (e) {
    console.error("finance: could not load category tags", describeError(e));
    return new Map();
  }
}

export async function saveTxnCategory(sourceId: string, category: string): Promise<void> {
  const id = sourceId.trim().slice(0, 128);
  if (!id || !CATEGORY_KEYS.includes(category)) return;
  try {
    await ensureTable();
    await db().execute(sql`
      insert into public.txn_overrides (source_id, category)
      values (${id}, ${category})
      on conflict (source_id) do update set category = excluded.category
    `);
  } catch (e) {
    console.error("finance: could not save category", describeError(e));
  }
}

export async function clearTxnCategory(sourceId: string): Promise<void> {
  const id = sourceId.trim();
  if (!id) return;
  try {
    await ensureTable();
    await db().delete(txnOverrides).where(eq(txnOverrides.sourceId, id));
  } catch (e) {
    console.error("finance: could not clear category", describeError(e));
  }
}
