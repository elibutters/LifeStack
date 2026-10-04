"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { fromForm } from "@/lib/profile-core";
import { saveProfileData } from "@/lib/profile";

export async function saveProfile(form: FormData): Promise<void> {
  await requireSession();
  const result = await saveProfileData(fromForm(form));
  if (!result.ok) redirect("/profile?error=invalid");
  revalidatePath("/profile");
  redirect("/profile?saved=1");
}
