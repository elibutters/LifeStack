import type { Metadata } from "next";
import { Card } from "@/components/card";
import { SessionBody } from "@/components/event-row";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";
import { TZ } from "@/lib/dates";
import { getGoal, listGoals, tonight } from "@/lib/goals";
import { moveAction, notebookAction, refreshCalendarAction, skipAction, startGoalAction } from "./actions";
import { DoneForm, GoalDone, SessionActions } from "./session-actions";

export const metadata: Metadata = { title: "Goals" };
export const dynamic = "force-dynamic";
export const maxDuration = 60; // moving a session updates the calendar

const small = "h-8 rounded-md border border-line px-3 text-sm text-muted hover:bg-raised hover:text-fg";
const time = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const when = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const hours = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}` : `${min} min`);

const TONE: Record<string, string> = { done: "bg-ok/15 text-ok", skipped: "bg-fg/10 text-muted", replaced: "bg-fg/10 text-muted", planned: "bg-warn/15 text-warn" };
type Detail = NonNullable<Awaited<ReturnType<typeof getGoal>>>;
type SessionItem = Detail["sessions"][number];

// One session in a goal: status top right (or the buttons while it is still planned), then the time, and the note and linked run on one line.
function SessionRow({ s, now }: { s: SessionItem; now: number }) {
  const late = s.status === "planned" && Date.parse(s.end) < now;
  return (
    <li className="rounded-md border border-line bg-raised/40 px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className={s.status === "skipped" || s.status === "replaced" || late ? "text-muted line-through" : "font-medium"}>{s.title}</p>
        {s.status === "planned" ? (
          <SessionActions id={s.id} late={late} />
        ) : (
          <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-xs capitalize ${TONE[s.status] ?? TONE.planned}`}>{s.status}</span>
        )}
      </div>
      <p className="text-xs text-muted">{when(s.start)} &middot; {s.minutes} min</p>
      <SessionBody noteBlocks={s.noteBlocks} notesBlocks={s.notesBlocks} actual={s.actual} comment={s.logNote} />
    </li>
  );
}

function Btn({ action, id, label, extra }: { action: (f: FormData) => Promise<void>; id: string; label: string; extra?: Record<string, string> }) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      {Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" className={small}>{label}</button>
    </form>
  );
}

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ note?: string }> }) {
  await requireSession();
  const note = (await searchParams).note;
  const [ton, goals] = await Promise.all([tonight().catch(() => null), listGoals().catch(() => null)]);
  // Active goals lead, then drafts, then anything finished or put away.
  const ORDER: Record<string, number> = { active: 0, draft: 1, done: 2, archived: 3 };
  const details = goals
    ? (await Promise.all(goals.map((g) => getGoal(g.id)))).filter((d): d is NonNullable<typeof d> => !!d).sort((a, b) => (ORDER[a.goal.status] ?? 9) - (ORDER[b.goal.status] ?? 9))
    : null;
  const names = new Map((goals ?? []).map((g) => [g.id, g.title]));

  return (
    <>
      <PageHeader>
        <h1 className="text-3xl font-semibold tracking-tight">Goals</h1>
      </PageHeader>
      <div className="max-w-3xl space-y-4">
        {note && <p className="rounded-md border border-accent/30 bg-accent/10 px-4 py-3 text-sm">{note}</p>}

        <Card title="Tonight" action={ton ? <span className="text-sm text-muted tabular-nums">{hours(ton.freeMinutesLeftToday)} free left today</span> : undefined}>
          {!ton ? (
            <p className="py-2 text-sm text-danger">Couldn&apos;t load tonight. Try again shortly.</p>
          ) : (
            <div className="space-y-3">
              {ton.needsDecision.map((d) => (
                <div key={d.session.id} className="rounded-md border border-accent/40 bg-accent/10 p-3">
                  <p className="font-medium">{d.session.title} <span className="text-sm font-normal text-muted">was {when(d.session.start)}</span></p>
                  <p className="mt-0.5 text-xs text-muted">{d.goal ?? "Goal"} &middot; it slipped. {d.suggestion ? `Next free slot: ${when(d.suggestion.start)}.` : "There is no free slot before the goal's last day."}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {d.suggestion && <Btn action={moveAction} id={d.session.id} label="Move there" extra={{ start: d.suggestion.start }} />}
                    <DoneForm id={d.session.id} label="I did it" />
                    <Btn action={skipAction} id={d.session.id} label="Skip" />
                  </div>
                </div>
              ))}
              {ton.sessions.filter((s) => !ton.needsDecision.some((d) => d.session.id === s.id)).map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className={s.status === "done" ? "text-muted line-through" : "font-medium"}>{s.title}</p>
                    <p className="text-xs text-muted">{time(s.start)} to {time(s.end)} &middot; {names.get(s.goalId) ?? "Goal"} &middot; {s.minutes} min{s.status === "done" ? " · done" : ""}{s.actual ? ` · ${s.actual.summary}` : ""}</p>
                    {s.logNote && <p className="text-xs text-muted">{s.logNote}</p>}
                  </div>
                  {s.status === "planned" && <SessionActions id={s.id} />}
                </div>
              ))}
              {ton.sessions.length === 0 && ton.needsDecision.length === 0 && <p className="py-2 text-sm text-muted">Nothing planned for today. Ask your assistant to plan something, or take the evening.</p>}
            </div>
          )}
        </Card>

        {!details ? (
          <p className="text-sm text-danger">Couldn&apos;t load your goals. Try again shortly.</p>
        ) : details.length === 0 ? (
          <Card title="No goals yet">
            <p className="py-2 text-sm text-muted">Goals are planned with your assistant: tell it what you are working toward and when, and it fits sessions into your real free time and puts them on your calendar. Try &quot;set up interview prep, interview on Nov 9, an hour every other day&quot;.</p>
          </Card>
        ) : (
          <>
            <GoalGroup label="Live" items={details.filter((d) => d.goal.status === "active")} />
            <GoalGroup label="Draft" items={details.filter((d) => d.goal.status === "draft")} />
            <GoalGroup label="Done" items={details.filter((d) => d.goal.status === "done")} />
            <GoalGroup label="Archived" items={details.filter((d) => d.goal.status === "archived")} />
          </>
        )}
        <form action={refreshCalendarAction} className="flex flex-wrap items-center gap-3 pt-2">
          <button type="submit" className={small}>Refresh calendar events</button>
          <span className="text-xs text-muted">Rewrites each session&apos;s Outlook event in the current layout. Press again if some are left.</span>
        </form>
      </div>
    </>
  );
}

function GoalGroup({ label, items }: { label: string; items: Detail[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <h2 className="pt-2 text-lg font-semibold tracking-tight">{label}</h2>
      {items.map((d) => <GoalCard key={d.goal.id} detail={d} />)}
    </>
  );
}

// A finished or archived goal shows its comment and counts. The sessions stay folded until opened.
function GoalCard({ detail }: { detail: Detail }) {
  const { goal, progress, next, notebook, sessions } = detail;
  const finished = goal.status === "done";
  const quiet = finished || goal.status === "archived";
  const total = progress.done + progress.planned; // the sessions still in the plan; skipped ones are not part of the count
  const badge = finished
    ? "bg-ok/15 text-ok font-semibold uppercase tracking-wide"
    : goal.status === "active"
      ? "bg-ok/15 text-ok capitalize"
      : "bg-fg/10 text-muted capitalize";
  const live = sessions.filter((s) => s.status !== "skipped");
  const skipped = sessions.filter((s) => s.status === "skipped");
  const now = Date.now();
  const doneCount = live.filter((x) => x.status === "done").length;
  const sessionsList = (
    <div className="mt-3 space-y-2">
      <details>
        <summary className="flex cursor-pointer items-center gap-3 text-sm font-medium">
          Sessions
          <span className="font-normal text-muted tabular-nums">{doneCount} / {live.length} done</span>
          {!quiet && (
            <span aria-hidden="true" className="h-1.5 w-24 overflow-hidden rounded-sm bg-raised">
              <span className="block h-full rounded-sm bg-accent/70" style={{ width: `${live.length ? Math.round((doneCount / live.length) * 100) : 0}%` }} />
            </span>
          )}
        </summary>
        {live.length ? <ul className="mt-2 space-y-2">{live.map((s) => <SessionRow key={s.id} s={s} now={now} />)}</ul> : <p className="py-2 text-sm text-muted">No sessions yet.</p>}
      </details>
      {skipped.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-muted">Skipped ({skipped.length})</summary>
          <ul className="mt-2 space-y-2">{skipped.map((s) => <SessionRow key={s.id} s={s} now={now} />)}</ul>
        </details>
      )}
    </div>
  );
  const more = (
    <>
      {quiet && goal.thesis && <p className="mb-2 text-sm text-muted">{goal.thesis.length > 220 ? `${goal.thesis.slice(0, 220)}...` : goal.thesis}</p>}
      <p className="mt-2 text-xs text-muted">
        {goal.kind}{goal.targetDay ? ` · by ${goal.targetDay}` : ""} &middot; when a session slips: {goal.mode}{next && !quiet ? ` · next: ${when(next.start)}` : ""}
      </p>
      {sessionsList}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {notebook ? (
          <a href={notebook} target="_blank" rel="noopener noreferrer" className={small}>Open notebook</a>
        ) : (
          <form action={notebookAction}>
            <input type="hidden" name="goalId" value={goal.id} />
            <button type="submit" className={small}>Create Notion notebook</button>
          </form>
        )}
        {goal.status === "draft" && (
          <form action={startGoalAction}>
            <input type="hidden" name="goalId" value={goal.id} />
            <button type="submit" className={small}>Start</button>
          </form>
        )}
        {(goal.status === "active" || goal.status === "draft") && <GoalDone id={goal.id} />}
      </div>
    </>
  );
  return (
    <Card
      title={goal.title}
      className={finished ? "ring-1 ring-ok/50" : ""}
      action={<span className={`rounded-sm px-1.5 py-0.5 text-xs ${badge}`}>{finished ? "Done" : goal.status}</span>}
    >
      {!quiet && goal.thesis && <p className="mb-2 text-sm text-muted">{goal.thesis.length > 220 ? `${goal.thesis.slice(0, 220)}...` : goal.thesis}</p>}
      {finished && goal.doneNote && <p className="mb-2 text-sm"><span className="mr-2 text-xs text-muted">Comment</span>{goal.doneNote}</p>}
      {!quiet && <div className="h-1.5 rounded-sm bg-raised"><div className="h-full rounded-sm bg-accent/70" style={{ width: `${total ? Math.round((progress.done / total) * 100) : 0}%` }} /></div>}
      <p className={`${quiet ? "" : "mt-1.5"} text-sm tabular-nums`}>
        {progress.done} of {total} sessions done{progress.skipped ? `, ${progress.skipped} skipped` : ""}{progress.minutesDone ? ` · ${hours(progress.minutesDone)} so far` : ""}
      </p>
      {quiet ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-muted">Details</summary>
          {more}
        </details>
      ) : more}
    </Card>
  );
}
