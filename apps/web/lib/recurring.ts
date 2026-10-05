import "server-only";
import { eq, sql } from "drizzle-orm";
import { recurringTags } from "@lifestack/db";
import { db } from "./db";
import { describeError } from "./errors";
import { CADENCE_OPTIONS, BUCKET_OPTIONS, type RecurringCadence, type RecurringBucket, type RecurringTag } from "./finance-calc";

let ready = false;
async function ensureTable(): Promise<void> {
  if (ready) return;
  await db().execute(sql`
    create table if not exists public.recurring_tags (
      key text primary key not null,
      name text not null,
      cadence text not null,
      bucket text default 'other' not null,
      created_at timestamptz default now() not null
    )
  `);
  await db().execute(sql`alter table public.recurring_tags add column if not exists bucket text default 'other' not null`);
  ready = true;
}

export async function loadRecurringTags(): Promise<RecurringTag[]> {
  try {
    await ensureTable();
    const rows = await db().select().from(recurringTags);
    return rows.flatMap((r) => {
      if (!CADENCE_OPTIONS.includes(r.cadence as RecurringCadence)) return [];
      const bucket = BUCKET_OPTIONS.includes(r.bucket as RecurringBucket) ? (r.bucket as RecurringBucket) : "other";
      return [{ key: r.key, name: r.name, cadence: r.cadence as RecurringCadence, bucket }];
    });
  } catch (e) {
    console.error("finance: could not load recurring tags", describeError(e));
    return [];
  }
}

export async function saveRecurringTag(tag: RecurringTag): Promise<void> {
  const key = tag.key.trim().toLowerCase().slice(0, 80);
  const name = tag.name.trim().slice(0, 80);
  if (!key || !name || !CADENCE_OPTIONS.includes(tag.cadence) || !BUCKET_OPTIONS.includes(tag.bucket)) return;
  try {
    await ensureTable();
    await db().execute(sql`
      insert into public.recurring_tags (key, name, cadence, bucket)
      values (${key}, ${name}, ${tag.cadence}, ${tag.bucket})
      on conflict (key) do update set name = excluded.name, cadence = excluded.cadence, bucket = excluded.bucket
    `);
  } catch (e) {
    console.error("finance: could not save recurring tag", describeError(e));
  }
}

export async function deleteRecurringTag(key: string): Promise<void> {
  const clean = key.trim().toLowerCase();
  if (!clean) return;
  try {
    await ensureTable();
    await db().delete(recurringTags).where(eq(recurringTags.key, clean));
  } catch (e) {
    console.error("finance: could not remove recurring tag", describeError(e));
  }
}
