"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { resetSetting } from "@/lib/settings";

export async function resetSettingAction(form: FormData): Promise<void> {
  await requireSession();
  await resetSetting(String(form.get("key") ?? ""));
  revalidatePath("/preferences");
  revalidatePath("/map");
}
