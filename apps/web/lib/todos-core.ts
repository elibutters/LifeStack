import { z } from "zod";

// Pure rules for the to-do list. Open items come first (soonest due, then oldest); done and dropped trail.
export const TODO_STATUSES = ["open", "done", "dropped"] as const;
export const TODO_SOURCES = ["web", "agent", "app"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];
export type TodoSource = (typeof TODO_SOURCES)[number];

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === "" ? null : s));

const Day = z
  .string()
  .trim()
  .refine((s) => s === "" || (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s)), "must be YYYY-MM-DD")
  .transform((s) => (s === "" ? null : s));

const Title = z.string().trim().min(1).max(200);

export const TodoInput = z.object({ title: Title, note: text(2000).nullish(), due: Day.nullish() });
export const TodoPatch = z
  .object({ title: Title, note: text(2000), due: Day, status: z.enum(TODO_STATUSES) })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "nothing to change");

export type Todo = {
  id: number;
  title: string;
  note: string | null;
  status: TodoStatus;
  due: string | null;
  source: TodoSource;
  createdAt: string;
  completedAt: string | null;
};

export function sortTodos<T extends Pick<Todo, "status" | "due" | "createdAt">>(items: T[]): T[] {
  const rank = (t: T) => (t.status === "open" ? 0 : 1);
  return [...items].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.status === "open") {
      if (a.due !== b.due) return a.due === null ? 1 : b.due === null ? -1 : a.due < b.due ? -1 : 1;
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    }
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });
}

export function summarize(items: Pick<Todo, "status" | "due">[], today: string) {
  const open = items.filter((t) => t.status === "open");
  return { open: open.length, overdue: open.filter((t) => t.due != null && t.due < today).length, done: items.filter((t) => t.status === "done").length };
}
