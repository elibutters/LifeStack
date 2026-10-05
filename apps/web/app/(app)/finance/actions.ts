"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { BUCKET_OPTIONS, CADENCE_OPTIONS, bucketFromCategory, merchantKey } from "@/lib/finance-calc";
import { deleteRecurringTag, loadRecurringTags, saveRecurringTag } from "@/lib/recurring";
import { clearTxnCategory, saveTxnCategory } from "@/lib/txn-overrides";

const Tag = z.object({
  key: z.string().trim().min(2).max(80),
  name: z.string().trim().min(1).max(80),
  cadence: z.enum(CADENCE_OPTIONS),
  bucket: z.enum(BUCKET_OPTIONS),
});

export async function tagRecurring(key: string, name: string, cadence: string, bucket: string): Promise<void> {
  await requireSession();
  const parsed = Tag.safeParse({ key, name, cadence, bucket });
  if (!parsed.success) return;
  await saveRecurringTag(parsed.data);
  revalidatePath("/finance", "layout");
}

export async function untagRecurring(key: string): Promise<void> {
  await requireSession();
  await deleteRecurringTag(key);
  revalidatePath("/finance", "layout");
}

export async function setTxnCategory(sourceId: string, category: string): Promise<void> {
  await requireSession();
  const id = z.string().trim().min(1).max(128).safeParse(sourceId);
  const cat = z.string().trim().min(1).max(60).safeParse(category);
  if (!id.success || !cat.success) return;
  if (cat.data === "plaid") await clearTxnCategory(id.data);
  else await saveTxnCategory(id.data, cat.data);
  revalidatePath("/finance", "layout");
}

export async function setTxnRecurring(sourceId: string, name: string, merchant: string, cadence: string, category: string | null): Promise<void> {
  await requireSession();
  const key = merchantKey({ name, merchant: merchant.trim() || null });
  if (!key || key.length < 2) return;
  const label = (merchant.trim() || name).slice(0, 80);
  if (!cadence || cadence === "none") {
    await deleteRecurringTag(key);
    revalidatePath("/finance", "layout");
    return;
  }
  const existing = (await loadRecurringTags()).find((t) => t.key === key);
  const bucket = existing?.bucket ?? bucketFromCategory(category);
  const parsed = Tag.safeParse({ key, name: label, cadence, bucket });
  if (!parsed.success) return;
  await saveRecurringTag(parsed.data);
  revalidatePath("/finance", "layout");
}

