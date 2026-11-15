"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { ChevronRightIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { addDays, fmtDayShort } from "@/lib/dates";
import { groupTodos, OPEN_BUCKETS, sortTodos, summarize, type OpenBucket, type Todo, type TodoStatus } from "@/lib/todos-core";
import { addTodoAction, editTodo, removeTodo, setTodoStatus } from "./actions";

const BUCKET_LABEL: Record<OpenBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  anytime: "No date",
};

const box = "rounded-md border border-muted/50 bg-bg text-sm outline-none placeholder:text-muted focus:border-accent";
const field = `h-9 w-full min-w-0 px-2.5 ${box}`;
const textBtn = "h-7 shrink-0 rounded-md border border-muted/40 px-2.5 text-sm text-muted hover:border-fg/50 hover:text-fg";
const saveBtn = "h-7 shrink-0 rounded-md bg-fg px-3 text-sm font-medium text-bg disabled:opacity-40";

type Draft = { id: number; title: string; note: string; due: string };
type Action =
  | { type: "add"; item: Todo }
  | { type: "delete"; id: number }
  | { type: "status"; id: number; status: TodoStatus }
  | { type: "edit"; id: number; title: string; note: string | null; due: string | null; status?: TodoStatus }
  | { type: "batch"; actions: Action[] };

function reduce(items: Todo[], action: Action): Todo[] {
  if (action.type === "batch") return action.actions.reduce(reduce, items);
  if (action.type === "delete") return items.filter((t) => t.id !== action.id);
  if (action.type === "add") return sortTodos([...items, action.item]);
  return sortTodos(
    items.map((t) => {
      if (t.id !== action.id) return t;
      const next: Todo = action.type === "edit" ? { ...t, title: action.title, note: action.note, due: action.due } : t;
      const status = action.status;
      if (!status) return next;
      return { ...next, status, completedAt: status === "done" ? (t.completedAt ?? new Date().toISOString()) : null };
    }),
  );
}

const editAction = (d: Draft, status?: TodoStatus): Action => ({
  type: "edit",
  id: d.id,
  title: d.title,
  note: d.note || null,
  due: d.due || null,
  status,
});

const utc = (day: string) => new Date(`${day}T00:00:00Z`);

function plainDate(due: string, today: string): string {
  if (due.slice(0, 4) === today.slice(0, 4)) return fmtDayShort(due);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(utc(due));
}

function dueText(due: string, today: string): string {
  if (due === today) return "Today";
  if (due === addDays(today, 1)) return "Tomorrow";
  if (due === addDays(today, -1)) return "Yesterday";
  return plainDate(due, today);
}

function dueTone(due: string, today: string): string {
  if (due < today) return "text-danger";
  if (due === today) return "text-accent";
  if (due === addDays(today, 1)) return "text-fg";
  return "text-muted";
}

function sourceLabel(source: Todo["source"]): string | null {
  if (source === "agent") return "Added by an agent";
  if (source === "app") return "Added in the app";
  return null;
}

export function TodoBoard({ items: incoming, today }: { items: Todo[]; today: string }) {
  const router = useRouter();
  const [items, apply] = useOptimistic(incoming, reduce);
  const [, start] = useTransition();
  const [adding, startAdd] = useTransition();
  const draftRef = useRef<Draft | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [composing, setComposing] = useState(incoming.length === 0);
  const [showDone, setShowDone] = useState(false);
  const [showDropped, setShowDropped] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const take = (): Draft | null => {
    const d = draftRef.current;
    draftRef.current = null;
    return d;
  };

  function run(actions: Action[], job: () => Promise<boolean>) {
    start(async () => {
      try {
        if (actions.length === 1) apply(actions[0]!);
        else if (actions.length > 1) apply({ type: "batch", actions });
        setProblem((await job()) ? null : "Couldn't save that change.");
      } catch {
        setProblem("Couldn't save that change.");
      }
      router.refresh();
    });
  }

  function select(id: number) {
    const d = take();
    setEditing(id);
    if (!d || d.id === id) return;
    run([editAction(d)], async () => (await editTodo(d.id, d)).ok);
  }

  function closeEditor(save: boolean) {
    const d = save ? take() : null;
    if (!save) draftRef.current = null;
    setEditing(null);
    if (!d) return;
    run([editAction(d)], async () => (await editTodo(d.id, d)).ok);
  }

  function toggle(t: Todo) {
    if (t.id < 0) return;
    const d = take();
    const status: TodoStatus = t.status === "open" ? "done" : "open";
    if (editing === t.id) setEditing(null);
    const same = d?.id === t.id;
    const actions: Action[] = [];
    if (d && !same) actions.push(editAction(d));
    actions.push(same && d ? editAction(d, status) : { type: "status", id: t.id, status });
    run(actions, async () => {
      if (d && !(await editTodo(d.id, d)).ok) return false;
      await setTodoStatus(t.id, status);
      return true;
    });
  }

  function drop(t: Todo) {
    const d = take();
    setEditing(null);
    const same = d?.id === t.id;
    const actions: Action[] = [];
    if (d && !same) actions.push(editAction(d));
    actions.push(same && d ? editAction(d, "dropped") : { type: "status", id: t.id, status: "dropped" });
    run(actions, async () => {
      if (d && !(await editTodo(d.id, d)).ok) return false;
      await setTodoStatus(t.id, "dropped");
      return true;
    });
  }

  function remove(id: number) {
    const draft = draftRef.current;
    const d = draft && draft.id !== id ? draft : null;
    draftRef.current = null;
    setEditing((cur) => (cur === id ? null : cur));
    const actions: Action[] = [];
    if (d) actions.push(editAction(d));
    actions.push({ type: "delete", id });
    run(actions, async () => {
      if (d && !(await editTodo(d.id, d)).ok) return false;
      await removeTodo(id);
      return true;
    });
  }

  const grouped = groupTodos(items, today);
  const groups = OPEN_BUCKETS.flatMap((id) => (grouped.open[id].length ? [{ id, list: grouped.open[id] }] : []));
  const showHeads = groups.length > 1;
  const s = summarize(items, today);
  const activeId = items.some((t) => t.id === editing) ? editing : null;

  return (
    <>
      <PageHeader>
        <h1 className="text-3xl font-semibold tracking-tight">To do</h1>
        <p className="mt-1 text-sm text-muted tabular-nums">
          {s.open === 0 ? (
            "Nothing open"
          ) : (
            <>
              {s.open} open
              {s.overdue > 0 && (
                <>
                  {" · "}
                  <span className="text-danger">{s.overdue} overdue</span>
                </>
              )}
            </>
          )}
        </p>
      </PageHeader>
      <div className="max-w-3xl">
        {problem && <p className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">{problem}</p>}
        <div className="min-w-0 overflow-hidden rounded-md border border-line bg-surface">
          <Composer
            open={composing}
            adding={adding}
            onOpen={() => {
              const d = take();
              setEditing(null);
              setComposing(true);
              if (d) run([editAction(d)], async () => (await editTodo(d.id, d)).ok);
            }}
            onClose={() => setComposing(false)}
            onAdd={(input) => {
              setProblem(null);
              startAdd(async () => {
                try {
                  apply({
                    type: "add",
                    item: {
                      id: -Date.now(),
                      title: input.title,
                      note: input.note || null,
                      due: input.due || null,
                      status: "open",
                      source: "web",
                      createdAt: new Date().toISOString(),
                      completedAt: null,
                    },
                  });
                  const r = await addTodoAction({ title: input.title, note: input.note, due: input.due });
                  if (!r.ok) {
                    setProblem("Couldn't add that. A title is required, and a due date has to be a real date.");
                    return;
                  }
                  setProblem(null);
                  router.refresh();
                } catch {
                  setProblem("Couldn't add that. A title is required, and a due date has to be a real date.");
                }
              });
            }}
            separated={groups.length > 0}
          />
          {groups.map((g, i) => (
            <section key={g.id} className={i > 0 ? "border-t border-line" : ""} aria-labelledby={showHeads ? `todo-${g.id}` : undefined}>
              {showHeads && (
                <div className="flex items-baseline gap-2 pr-4 pl-11 pt-3 pb-1">
                  <h2 id={`todo-${g.id}`} className={`text-xs font-medium ${g.id === "overdue" ? "text-danger" : "text-muted"}`}>
                    {BUCKET_LABEL[g.id]}
                  </h2>
                  <span className="text-xs text-muted tabular-nums">{g.list.length}</span>
                </div>
              )}
              <ul className="divide-y divide-line">
                {g.list.map((t) => (
                  <Row
                    key={t.id}
                    t={t}
                    today={today}
                    mode="open"
                    bucket={g.id}
                    showHeads={showHeads}
                    active={activeId === t.id}
                    draftRef={draftRef}
                    onToggle={() => toggle(t)}
                    onSelect={() => select(t.id)}
                    onSave={() => closeEditor(true)}
                    onCancel={() => closeEditor(false)}
                    onDrop={() => drop(t)}
                    onDelete={() => remove(t.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
          {grouped.done.length > 0 && (
            <Fold label="Done" count={grouped.done.length} open={showDone} onToggle={() => setShowDone((v) => !v)}>
              {grouped.done.map((t) => (
                <Row
                  key={t.id}
                  t={t}
                  today={today}
                  mode="done"
                  bucket="anytime"
                  showHeads={false}
                  active={activeId === t.id}
                  draftRef={draftRef}
                  onToggle={() => toggle(t)}
                  onSelect={() => select(t.id)}
                  onSave={() => closeEditor(true)}
                  onCancel={() => closeEditor(false)}
                  onDrop={() => drop(t)}
                  onDelete={() => remove(t.id)}
                />
              ))}
            </Fold>
          )}
          {grouped.dropped.length > 0 && (
            <Fold label="Dropped" count={grouped.dropped.length} open={showDropped} onToggle={() => setShowDropped((v) => !v)}>
              {grouped.dropped.map((t) => (
                <Row
                  key={t.id}
                  t={t}
                  today={today}
                  mode="dropped"
                  bucket="anytime"
                  showHeads={false}
                  active={activeId === t.id}
                  draftRef={draftRef}
                  onToggle={() => toggle(t)}
                  onSelect={() => select(t.id)}
                  onSave={() => closeEditor(true)}
                  onCancel={() => closeEditor(false)}
                  onDrop={() => drop(t)}
                  onDelete={() => remove(t.id)}
                />
              ))}
            </Fold>
          )}
        </div>
      </div>
    </>
  );
}

function Composer({
  open,
  adding,
  separated,
  onOpen,
  onClose,
  onAdd,
}: {
  open: boolean;
  adding: boolean;
  separated: boolean;
  onOpen: () => void;
  onClose: () => void;
  onAdd: (input: { title: string; note: string; due: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const next = title.trim();
    if (!next || adding) return;
    onAdd({ title: next, note: note.trim(), due });
    setTitle("");
    setNote("");
    setDue("");
    titleRef.current?.focus();
  }

  if (!open) {
    return (
      <button type="button" onClick={onOpen} className={`flex w-full items-center pr-4 text-left text-muted hover:bg-raised/40 hover:text-fg ${separated ? "border-b border-line" : ""}`}>
        <span className="grid h-11 w-11 place-items-center">
          <span className="grid h-[18px] w-[18px] place-items-center rounded-sm border border-dashed border-current">
            <Plus />
          </span>
        </span>
        Add a to-do
      </button>
    );
  }

  return (
    <form autoComplete="off" onSubmit={submit} className={`space-y-2 px-4 py-3 ${separated ? "border-b border-line" : ""}`}>
      <input
        ref={titleRef}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setTitle("");
            setNote("");
            setDue("");
            onClose();
          }
        }}
        maxLength={200}
        placeholder="What needs doing"
        aria-label="Title"
        className={field}
      />
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="Note" aria-label="Note" className={field} />
      <div className="flex flex-wrap items-center gap-2">
        <DueField due={due} onChange={setDue} />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setTitle("");
              setNote("");
              setDue("");
              onClose();
            }}
            className={textBtn}
          >
            Cancel
          </button>
          <button type="submit" disabled={adding || !title.trim()} className={saveBtn}>
            Add
          </button>
        </div>
      </div>
    </form>
  );
}

function Fold({ label, count, open, onToggle, children }: { label: string; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="border-t border-line">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center pr-4 text-left text-sm text-muted hover:bg-raised/40">
        <span className="grid h-11 w-11 place-items-center">
          <ChevronRightIcon width={16} height={16} className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
        </span>
        {label}
        <span className="ml-2 tabular-nums">{count}</span>
      </button>
      {open ? <ul className="divide-y divide-line border-t border-line">{children}</ul> : null}
    </section>
  );
}

function Row({
  t,
  today,
  mode,
  bucket,
  showHeads,
  active,
  draftRef,
  onToggle,
  onSelect,
  onSave,
  onCancel,
  onDrop,
  onDelete,
}: {
  t: Todo;
  today: string;
  mode: "open" | "done" | "dropped";
  bucket: OpenBucket;
  showHeads: boolean;
  active: boolean;
  draftRef: RefObject<Draft | null>;
  onToggle: () => void;
  onSelect: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDrop: () => void;
  onDelete: () => void;
}) {
  const when = t.due && mode === "open" && !(bucket === "today" && showHeads) ? dueText(t.due, today) : t.due && mode !== "open" ? plainDate(t.due, today) : null;
  const tone = t.due && mode === "open" ? dueTone(t.due, today) : "text-muted";
  return (
    <li className={`group flex pr-3 ${active ? "items-start bg-raised/60" : "items-center"} ${t.id < 0 ? "opacity-60" : ""}`}>
      <button
        type="button"
        disabled={t.id < 0}
        aria-pressed={t.status === "done"}
        aria-label={t.status === "open" ? `Mark ${t.title} done` : `Reopen ${t.title}`}
        onClick={onToggle}
        className="grid h-11 w-11 shrink-0 place-items-center disabled:cursor-default"
      >
        <Mark status={t.status} />
      </button>
      {active ? (
        <Editor t={t} draftRef={draftRef} onSave={onSave} onCancel={onCancel} onDrop={onDrop} onDelete={onDelete} />
      ) : (
        <>
          <div className="min-w-0 flex-1 py-2.5">
            <p className={`break-words ${mode === "done" ? "text-muted line-through decoration-muted/60" : mode === "dropped" ? "text-muted" : ""}`}>{t.title}</p>
            {t.note && <p className="mt-0.5 line-clamp-2 break-words text-sm text-muted">{t.note}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2 py-2.5 pl-3">
            {when && <span className={`text-sm whitespace-nowrap tabular-nums ${tone}`}>{when}</span>}
            {t.id > 0 && (
              <button type="button" onClick={onSelect} className={textBtn}>
                Edit
              </button>
            )}
          </div>
        </>
      )}
    </li>
  );
}

function Editor({
  t,
  draftRef,
  onSave,
  onCancel,
  onDrop,
  onDelete,
}: {
  t: Todo;
  draftRef: RefObject<Draft | null>;
  onSave: () => void;
  onCancel: () => void;
  onDrop: () => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(t.title);
  const [note, setNote] = useState(t.note ?? "");
  const [due, setDue] = useState(t.due ?? "");
  const [arm, setArm] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const dirty = title.trim() !== t.title || note.trim() !== (t.note ?? "") || due !== (t.due ?? "");
  const from = sourceLabel(t.source);

  useEffect(() => {
    draftRef.current = dirty && title.trim() ? { id: t.id, title: title.trim(), note: note.trim(), due } : null;
    return () => {
      draftRef.current = null;
    };
  }, [dirty, draftRef, due, note, t.id, title]);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.focus();
    const n = el.value.length;
    el.setSelectionRange(n, n);
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key !== "Enter") return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "TEXTAREA" && !e.metaKey && !e.ctrlKey) return;
    e.preventDefault();
    onSave();
  }

  return (
    <div className="min-w-0 flex-1 py-2.5" onKeyDown={onKeyDown}>
      <input
        ref={titleRef}
        value={title}
        onChange={(e) => {
          setArm(false);
          setTitle(e.target.value);
        }}
        maxLength={200}
        aria-label="Title"
        className={field}
      />
      <textarea
        value={note}
        onChange={(e) => {
          setArm(false);
          setNote(e.target.value);
        }}
        rows={2}
        maxLength={2000}
        placeholder="Note"
        aria-label="Note"
        className={`mt-2 w-full min-w-0 resize-none px-2.5 py-2 ${box}`}
      />
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <DueField
          due={due}
          onChange={(v) => {
            setArm(false);
            setDue(v);
          }}
        />
        {from && <span className="px-1.5 text-xs text-muted">{from}</span>}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {t.status === "open" && (
            <button type="button" onClick={onDrop} className={textBtn}>
              Drop
            </button>
          )}
          <button type="button" onClick={() => (arm ? onDelete() : setArm(true))} className="h-7 shrink-0 rounded-sm px-2 text-sm text-danger hover:bg-danger/10">
            {arm ? "Delete?" : "Delete"}
          </button>
          {dirty ? (
            <>
              <button type="button" onClick={onCancel} className={textBtn}>
                Cancel
              </button>
              <button type="button" onClick={onSave} disabled={!title.trim()} className={saveBtn}>
                Save
              </button>
            </>
          ) : (
            <button type="button" onClick={onCancel} className={textBtn}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DueField({ due, onChange }: { due: string; onChange: (v: string) => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <input type="date" value={due} aria-label="Due date" onChange={(e) => onChange(e.target.value)} className={`h-9 px-2.5 ${box}`} />
      {due ? <ClearDue onClick={() => onChange("")} /> : null}
    </span>
  );
}

function ClearDue({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Clear due date" onClick={onClick} className="grid h-7 w-7 place-items-center rounded-sm text-muted hover:bg-fg/10 hover:text-fg">
      <span aria-hidden className="text-sm leading-none">
        ×
      </span>
    </button>
  );
}

function Mark({ status }: { status: TodoStatus }) {
  const done = status === "done";
  const dropped = status === "dropped";
  return (
    <span
      className={`grid h-[18px] w-[18px] place-items-center rounded-sm border transition-colors duration-150 ${
        done ? "border-fg bg-fg text-bg" : dropped ? "border-muted/50 text-muted" : "border-muted/60 text-muted group-hover:border-fg/70"
      }`}
    >
      {dropped ? (
        <span className="h-px w-2 bg-current" />
      ) : (
        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={done ? "" : "opacity-0 group-hover:opacity-40"}>
          <path d="M3.5 8.5 6.5 11.5 12.5 5" />
        </svg>
      )}
    </span>
  );
}

function Plus() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M6 1.75v8.5M1.75 6h8.5" />
    </svg>
  );
}
