"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { addTodo, deleteTodo, updateTodo } from "@/lib/todos";
import { TODO_STATUSES } from "@/lib/todos-core";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const num = (f: FormData, k: string) => {
  const n = Number(str(f, k));
  return Number.isInteger(n) && n > 0 ? n : null;
};

export async function addTodoAction(form: FormData): Promise<void> {
  await requireSession();
  const r = await addTodo({ title: str(form, "title"), note: str(form, "note"), due: str(form, "due") }, "web");
  if (!r.ok) redirect("/todos?error=invalid");
  revalidatePath("/todos");
  redirect("/todos");
}

export async function setTodoStatus(form: FormData): Promise<void> {
  await requireSession();
  const id = num(form, "id");
  const status = str(form, "status");
  if (!id || !(TODO_STATUSES as readonly string[]).includes(status)) return;
  await updateTodo(id, { status });
  revalidatePath("/todos");
}

export async function removeTodo(form: FormData): Promise<void> {
  await requireSession();
  const id = num(form, "id");
  if (id) await deleteTodo(id);
  revalidatePath("/todos");
}
