"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
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
