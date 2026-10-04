"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { syncItem, unlinkItem } from "@/lib/finance";
import { disconnectOutlook, syncOutlook } from "@/lib/outlook";

// Server actions are POSTs to their page, so each one checks the session itself.
export async function syncNow(): Promise<void> {
  await requireSession();
  try {
    await syncOutlook();
  } catch {
    // The failure is recorded and shown on the Settings page.
  }
  revalidatePath("/", "layout");
}

export async function disconnect(): Promise<void> {
  await requireSession();
  await disconnectOutlook();
  revalidatePath("/", "layout");
}

export async function syncFinance(itemId: string): Promise<void> {
  await requireSession();
  try {
    await syncItem(itemId);
  } catch {
    // Recorded on the item and shown in Settings.
  }
  revalidatePath("/", "layout");
}

// Called after the owner re-authenticated an institution in Plaid's window. Reports whether the
// sync that follows actually worked, so the screen never claims a fix that did not happen.
export async function repairedFinance(itemId: string): Promise<boolean> {
  await requireSession();
  let ok = false;
  try {
    const outcome = await syncItem(itemId, { repaired: true });
    ok = outcome === "synced" || outcome === "not_ready";
  } catch {
    ok = false;
  }
  revalidatePath("/", "layout");
  return ok;
}

export async function unlinkFinance(itemId: string): Promise<void> {
  await requireSession();
  await unlinkItem(itemId); // on failure the item stays and shows an error in Settings
  revalidatePath("/", "layout");
}
