"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { addSlot, deleteSlot } from "@/lib/fitness-plan";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");

function refresh() {
  revalidatePath("/fitness");
  revalidatePath("/calendar");
  revalidatePath("/");
}

export async function addPlanItem(form: FormData): Promise<void> {
  await requireSession();
  try {
    const r = await addSlot({
      weekday: str(form, "weekday"),
      kind: str(form, "kind"),
      title: str(form, "title"),
      notes: str(form, "notes"),
      time: str(form, "time"),
      duration: str(form, "duration"),
    });
    if (!r.ok) redirect("/fitness?error=invalid");
  } catch (e) {
    console.error("plan: save failed", e);
    redirect("/fitness?error=sync");
  }
  refresh();
  redirect("/fitness");
}

export async function removePlanItem(form: FormData): Promise<void> {
  await requireSession();
  const id = Number(str(form, "id"));
  if (!Number.isInteger(id) || id <= 0) return;
  try {
    await deleteSlot(id);
  } catch (e) {
    console.error("plan: delete failed", e);
    redirect("/fitness?error=sync");
  }
  refresh();
}
