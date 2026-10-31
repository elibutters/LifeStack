import type { Metadata } from "next";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";
import { ymd } from "@/lib/dates";
import { listTodos } from "@/lib/todos";
import { summarize, type Todo } from "@/lib/todos-core";
import { addTodoAction, removeTodo, setTodoStatus } from "./actions";

export const metadata: Metadata = { title: "To do" };
export const dynamic = "force-dynamic";

const input = "h-9 w-full min-w-0 rounded-md border border-line bg-bg px-2.5 text-sm outline-none focus:border-accent";
const small = "h-7 rounded-md border border-line px-2 text-xs text-muted hover:bg-raised hover:text-fg";

function Btn({ action, id, status, label, aria }: { action: (f: FormData) => Promise<void>; id: number; status?: string; label: string; aria?: string }) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      {status && <input type="hidden" name="status" value={status} />}
      <button type="submit" className={small} aria-label={aria}>{label}</button>
    </form>
  );
}

function Row({ t, today }: { t: Todo; today: string }) {
  const open = t.status === "open";
  const late = open && t.due != null && t.due < today;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2">
      <div className="min-w-0">
        <p className={open ? "" : "text-muted line-through"}>{t.title}</p>
        {(t.note || t.due) && (
          <p className="mt-0.5 text-xs text-muted">
            {t.due && <span className={late ? "text-danger" : ""}>due {t.due}{late ? " (overdue)" : ""}</span>}
            {t.due && t.note ? " · " : ""}
            {t.note}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {open ? (
          <>
            <Btn action={setTodoStatus} id={t.id} status="done" label="Done" aria={`Mark ${t.title} done`} />
            <Btn action={setTodoStatus} id={t.id} status="dropped" label="Drop" aria={`Drop ${t.title}`} />
          </>
        ) : (
          <>
            <span className="mr-1 text-xs text-muted">{t.status}</span>
            <Btn action={setTodoStatus} id={t.id} status="open" label="Reopen" aria={`Reopen ${t.title}`} />
          </>
        )}
        <Btn action={removeTodo} id={t.id} label="Delete" aria={`Delete ${t.title}`} />
      </div>
    </li>
  );
}

export default async function TodosPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const items = await listTodos().catch(() => [] as Todo[]);
  const today = ymd(new Date());
  const s = summarize(items, today);
  const open = items.filter((t) => t.status === "open");
  const closed = items.filter((t) => t.status !== "open");

  return (
    <>
      <PageHeader>
        <h1 className="text-3xl font-semibold tracking-tight">To do</h1>
        <p className="mt-1 text-sm text-muted tabular-nums">
          {s.open} open{s.overdue ? ` · ${s.overdue} overdue` : ""}
        </p>
      </PageHeader>
      <div className="max-w-3xl space-y-4">
        {sp.error === "invalid" && (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-danger">That did not look right. A title is required and a due date must be a real date.</p>
        )}
        <Card title="Add an item">
          <p className="mb-2 text-sm text-muted">Agents add to and tick off this same list through the API and MCP, so it carries across sessions.</p>
          <form action={addTodoAction} className="grid grid-cols-3 gap-2">
            <input name="title" required maxLength={200} placeholder="What needs doing?" aria-label="Title" className={`${input} col-span-3`} />
            <input name="note" maxLength={2000} placeholder="Note (optional)" aria-label="Note" className={`${input} col-span-3 sm:col-span-2`} />
            <input name="due" type="date" aria-label="Due date" className={`${input} col-span-3 sm:col-span-1`} />
            <button type="submit" className="col-span-3 h-9 rounded-md bg-fg px-4 text-sm font-medium text-bg">Add</button>
          </form>
        </Card>
        <Card title="Open">
          {open.length ? <ul className="divide-y divide-line">{open.map((t) => <Row key={t.id} t={t} today={today} />)}</ul> : <p className="py-2 text-sm text-muted">Nothing open.</p>}
        </Card>
        {closed.length > 0 && (
          <Card title="Done or dropped">
            <ul className="divide-y divide-line">{closed.map((t) => <Row key={t.id} t={t} today={today} />)}</ul>
          </Card>
        )}
      </div>
    </>
  );
}
