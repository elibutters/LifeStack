"use client";

import { useState, useTransition } from "react";
import { doneAction, finishGoalAction, moveAction, skipAction, suggestTimesAction } from "./actions";

const small = "h-8 rounded-md border border-line px-3 text-sm text-muted hover:bg-raised hover:text-fg";
const area = "mt-1 w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent";
type Slot = { start: string; end: string; label: string };

// Done asks for a comment first. The comment is optional; marking done is what saves it.
export function DoneForm({ id, label = "Done" }: { id: string; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={small}>{label}</button>;
  return (
    <form action={doneAction} className="w-full basis-full space-y-2">
      <input type="hidden" name="id" value={id} />
      <label className="block text-xs text-muted">
        Comment
        <textarea name="note" rows={2} maxLength={1000} placeholder="Optional" aria-label="Comment" className={area} />
      </label>
      <div className="flex gap-2">
        <button type="submit" className={small}>Mark done</button>
        <button type="button" onClick={() => setOpen(false)} className={small}>Cancel</button>
      </div>
    </form>
  );
}

// The goal itself, separate from its sessions. A comment stays on the goal.
export function GoalDone({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={small}>Mark done</button>;
  return (
    <form action={finishGoalAction} className="w-full basis-full space-y-2">
      <input type="hidden" name="goalId" value={id} />
      <label className="block text-xs text-muted">
        Comment
        <textarea name="note" rows={2} maxLength={1000} placeholder="Optional" aria-label="Comment" className={area} />
      </label>
      <div className="flex gap-2">
        <button type="submit" className={small}>Mark goal done</button>
        <button type="button" onClick={() => setOpen(false)} className={small}>Cancel</button>
      </div>
    </form>
  );
}

function Post({ action, id, label, extra }: { action: (f: FormData) => Promise<void>; id: string; label: string; extra?: Record<string, string> }) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      {Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" className={small}>{label}</button>
    </form>
  );
}

// Done, Move and Skip for a planned session. Move does not move anything by itself: it opens a few free times (and any other time) to
// choose from, and only choosing one moves the session. It renders into its parent's row, the choices on a line of their own.
export function SessionActions({ id, late = false }: { id: string; late?: boolean }) {
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [custom, setCustom] = useState("");
  const [, run] = useTransition();

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && slots === null) run(async () => setSlots(await suggestTimesAction(id)));
  };

  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        {late && <span className="rounded-sm bg-fg/10 px-1.5 py-0.5 text-xs text-muted">Skipped</span>}
        {!marking && <button type="button" onClick={() => setMarking(true)} className={small}>Done</button>}
        <button type="button" onClick={toggle} aria-expanded={open} className={small}>Move</button>
        <Post action={skipAction} id={id} label="Skip" />
      </div>
      {marking && (
        <form action={doneAction} className="w-full basis-full space-y-2">
          <input type="hidden" name="id" value={id} />
          <label className="block text-xs text-muted">
            Comment
            <textarea name="note" rows={2} maxLength={1000} placeholder="Optional" aria-label="Comment" className={area} />
          </label>
          <div className="flex gap-2">
            <button type="submit" className={small}>Mark done</button>
            <button type="button" onClick={() => setMarking(false)} className={small}>Cancel</button>
          </div>
        </form>
      )}
      {open && (
        <div className="basis-full space-y-1.5 pt-1">
          <p className="text-xs text-muted">Pick a free time. Nothing moves until you choose one.</p>
          {slots === null && <p className="text-sm text-muted">Looking for free times...</p>}
          {slots?.length === 0 && <p className="text-sm text-muted">No free time found in the next few weeks. Pick a time below.</p>}
          <div className="flex flex-wrap gap-2">
            {slots?.map((s) => <Post key={s.start} action={moveAction} id={id} label={s.label} extra={{ start: s.start }} />)}
          </div>
          <form action={moveAction} className="flex flex-wrap items-center gap-2 pt-1">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="start" value={custom ? new Date(custom).toISOString() : ""} />
            <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Another time" className="h-8 rounded-md border border-line bg-bg px-2 text-sm" />
            <button type="submit" disabled={!custom} className={`${small} disabled:opacity-50`}>Move to this time</button>
          </form>
        </div>
      )}
    </>
  );
}
