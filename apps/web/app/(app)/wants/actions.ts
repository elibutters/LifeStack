"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { addOption, addWant, deleteOption, deleteWant, updateOption, updateWant } from "@/lib/wants";
import { OPTION_STATUSES, WANT_STATUSES } from "@/lib/wants-core";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const num = (f: FormData, k: string) => {
  const n = Number(str(f, k));
  return Number.isInteger(n) && n > 0 ? n : null;
};

// One thing: title plus an optional link, price and target become a want with a single option.
export async function addWantAction(form: FormData): Promise<void> {
  await requireSession();
  const hasOption = ["price", "target", "url"].some((k) => str(form, k).trim() !== "");
  const r = await addWant({
    title: str(form, "title"),
    note: str(form, "note"),
    budget: str(form, "budget"),
    first: hasOption ? { price: str(form, "price"), target: str(form, "target"), url: str(form, "url") } : undefined,
  });
  if (!r.ok) redirect("/wants?error=invalid");
  revalidatePath("/wants");
  redirect("/wants");
}

export async function addOptionAction(form: FormData): Promise<void> {
  await requireSession();
  const wantId = num(form, "wantId");
  if (!wantId) return;
  const r = await addOption(wantId, { title: str(form, "title"), price: str(form, "price"), target: str(form, "target"), url: str(form, "url"), note: "" });
  if (!r.ok) redirect("/wants?error=invalid");
  revalidatePath("/wants");
}

export async function setWantStatus(form: FormData): Promise<void> {
  await requireSession();
  const id = num(form, "id");
  const status = str(form, "status");
  if (!id || !(WANT_STATUSES as readonly string[]).includes(status)) return;
  await updateWant(id, { status });
  revalidatePath("/wants");
}

export async function setOptionStatus(form: FormData): Promise<void> {
  await requireSession();
  const id = num(form, "id");
  const status = str(form, "status");
  if (!id || !(OPTION_STATUSES as readonly string[]).includes(status)) return;
  await updateOption(id, { status });
  revalidatePath("/wants");
}

export async function setOptionPrice(form: FormData): Promise<void> {
  await requireSession();
  const id = num(form, "id");
  if (!id) return;
  await updateOption(id, { price: str(form, "price") });
  revalidatePath("/wants");
}

export async function removeWant(form: FormData): Promise<void> {
  await requireSession();
  const id = num(form, "id");
  if (id) await deleteWant(id);
  revalidatePath("/wants");
}

export async function removeOption(form: FormData): Promise<void> {
  await requireSession();
  const id = num(form, "id");
  if (id) await deleteOption(id);
  revalidatePath("/wants");
}
