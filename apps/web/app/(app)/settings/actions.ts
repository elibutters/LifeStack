"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { disconnectEight, saveEightConnection, syncEight } from "@/lib/eight";
import { syncItem, unlinkItem } from "@/lib/finance";
import { disconnectOutlook, syncOutlook } from "@/lib/outlook";

// Server actions are POSTs to their page, so each one checks the session itself.
export async function syncNow(): Promise<void> {
  await requireSession();
  try {
    await syncOutlook();
  } catch {
    // The failure is recorded and shown on the Connections page.
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
    // Recorded on the item and shown in Connections.
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
  await unlinkItem(itemId); // on failure the item stays and shows an error in Connections
  revalidatePath("/", "layout");
}

export async function connectEight(form: FormData): Promise<void> {
  await requireSession();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) redirect("/connections?error=eight_auth");
  try {
    await saveEightConnection(email, password);
  } catch {
    redirect("/connections?error=eight_auth");
  }
  after(() => syncEight().catch(() => {}));
  redirect("/connections?connected=eight");
}

export async function syncEightNow(): Promise<void> {
  await requireSession();
  try {
    await syncEight();
  } catch {
    // Recorded on the Connections page.
  }
  revalidatePath("/", "layout");
}

export async function disconnectEightNow(): Promise<void> {
  await requireSession();
  await disconnectEight();
  revalidatePath("/", "layout");
}
