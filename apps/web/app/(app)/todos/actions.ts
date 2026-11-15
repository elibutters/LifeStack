"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { addTodo, deleteTodo, updateTodo } from "@/lib/todos";
import { TODO_STATUSES, type TodoStatus } from "@/lib/todos-core";

const idOk = (id: number) => Number.isInteger(id) && id > 0;

export async function addTodoAction(input: { title: string; note: string; due: string }): Promise<{ ok: boolean }> {
  await requireSession();
  const r = await addTodo({ title: input.title, note: input.note, due: input.due }, "web");
  if (!r.ok) return { ok: false };
  revalidatePath("/todos");
  return { ok: true };
}

export async function editTodo(id: number, input: { title: string; note: string; due: string }): Promise<{ ok: boolean }> {
  await requireSession();
  if (!idOk(id)) return { ok: false };
  const r = await updateTodo(id, { title: input.title, note: input.note, due: input.due });
  if (!r.ok || !r.found) return { ok: false };
  revalidatePath("/todos");
  return { ok: true };
}

export async function setTodoStatus(id: number, status: TodoStatus): Promise<void> {
  await requireSession();
  if (!idOk(id) || !TODO_STATUSES.includes(status)) return;
  const r = await updateTodo(id, { status });
  if (r.ok) revalidatePath("/todos");
}

export async function removeTodo(id: number): Promise<void> {
  await requireSession();
  if (!idOk(id)) return;
  if (await deleteTodo(id)) revalidatePath("/todos");
}
