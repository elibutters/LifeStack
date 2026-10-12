"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { addWant, deleteWant, updateWant } from "@/lib/wants";
import { WANT_STATUSES } from "@/lib/wants-core";

export async function addWantAction(form: FormData): Promise<void> {
  await requireSession();
  const r = await addWant({
    title: String(form.get("title") ?? ""),
    note: String(form.get("note") ?? ""),
    url: String(form.get("url") ?? ""),
    price: String(form.get("price") ?? ""),
  });
  if (!r.ok) redirect("/wants?error=invalid");
  revalidatePath("/wants");
  redirect("/wants");
}

export async function setWantStatus(form: FormData): Promise<void> {
  await requireSession();
  const id = Number(form.get("id"));
  const status = String(form.get("status"));
  if (!Number.isInteger(id) || !(WANT_STATUSES as readonly string[]).includes(status)) return;
  await updateWant(id, { status });
  revalidatePath("/wants");
}

export async function removeWant(form: FormData): Promise<void> {
  await requireSession();
  const id = Number(form.get("id"));
  if (!Number.isInteger(id)) return;
  await deleteWant(id);
  revalidatePath("/wants");
}
