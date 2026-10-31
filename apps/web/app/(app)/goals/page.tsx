import type { Metadata } from "next";
import { Card } from "@/components/card";
import { SessionBody } from "@/components/event-row";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";
import { TZ } from "@/lib/dates";
import { getGoal, listGoals, tonight } from "@/lib/goals";
import { doneAction, moveAction, notebookAction, skipAction } from "./actions";

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
    <li className="py-2">
      <div className="flex items-start justify-between gap-3">
        <p className={s.status === "skipped" || s.status === "replaced" ? "text-muted line-through" : "font-medium"}>{s.title}</p>
        {s.status === "planned" && !late ? (
          <div className="flex shrink-0 gap-2">
            <Btn action={doneAction} id={s.id} label="Done" />
            <Btn action={moveAction} id={s.id} label="Move" />
            <Btn action={skipAction} id={s.id} label="Skip" />
          </div>
        ) : (
          <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-xs capitalize ${late ? "bg-danger/15 text-danger" : (TONE[s.status] ?? TONE.planned)}`}>{late ? "missed" : s.status}</span>
        )}
      </div>
      <p className="text-xs text-muted">{when(s.start)} &middot; {s.minutes} min</p>
      <SessionBody noteBlocks={s.noteBlocks} notesBlocks={s.notesBlocks} actual={s.actual} />
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
  const details = goals ? (await Promise.all(goals.map((g) => getGoal(g.id)))).filter((d): d is NonNullable<typeof d> => !!d) : null;
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
                    <Btn action={doneAction} id={d.session.id} label="I did it" />
                    <Btn action={skipAction} id={d.session.id} label="Skip" />
                  </div>
                </div>
              ))}
              {ton.sessions.filter((s) => !ton.needsDecision.some((d) => d.session.id === s.id)).map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className={s.status === "done" ? "text-muted line-through" : "font-medium"}>{s.title}</p>
                    <p className="text-xs text-muted">{time(s.start)} to {time(s.end)} &middot; {names.get(s.goalId) ?? "Goal"} &middot; {s.minutes} min{s.status === "done" ? " · done" : ""}{s.actual ? ` · ${s.actual.summary}` : ""}</p>
                  </div>
                  {s.status === "planned" && (
                    <div className="flex gap-2">
                      <Btn action={doneAction} id={s.id} label="Done" />
                      <Btn action={moveAction} id={s.id} label="Move" />
                      <Btn action={skipAction} id={s.id} label="Skip" />
                    </div>
                  )}
                </div>
              ))}
              {ton.sessions.length === 0 && ton.needsDecision.length === 0 && <p className="py-2 text-sm text-muted">Nothing planned for today. Ask your assistant to plan something, or take the evening.</p>}
            </div>
          )}
        </Card>

        <h2 className="pt-2 text-lg font-semibold tracking-tight">Your goals</h2>
        {!details ? (
          <p className="text-sm text-danger">Couldn&apos;t load your goals. Try again shortly.</p>
        ) : details.length === 0 ? (
          <Card title="No goals yet">
            <p className="py-2 text-sm text-muted">Goals are planned with your assistant: tell it what you are working toward and when, and it fits sessions into your real free time and puts them on your calendar. Try &quot;set up interview prep, interview on Nov 9, an hour every other day&quot;.</p>
          </Card>
        ) : (
          details.map(({ goal, progress, next, notebook, sessions }) => {
            const total = progress.done + progress.planned + progress.skipped;
            return (
              <Card key={goal.id} title={goal.title} action={<span className="text-xs text-muted">{goal.status}</span>}>
                {goal.thesis && <p className="mb-2 text-sm text-muted">{goal.thesis.length > 220 ? `${goal.thesis.slice(0, 220)}...` : goal.thesis}</p>}
                <div className="h-1.5 rounded-sm bg-raised"><div className="h-full rounded-sm bg-accent/70" style={{ width: `${total ? Math.round((progress.done / total) * 100) : 0}%` }} /></div>
                <p className="mt-1.5 text-sm tabular-nums">
                  {progress.done} of {total} sessions done{progress.skipped ? `, ${progress.skipped} skipped` : ""}{progress.minutesDone ? ` · ${hours(progress.minutesDone)} so far` : ""}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {goal.kind}{goal.targetDay ? ` · by ${goal.targetDay}` : ""} &middot; when a session slips: {goal.mode}{next ? ` · next: ${when(next.start)}` : ""}
                </p>
                {(() => {
                  const live = sessions.filter((s) => s.status !== "skipped");
                  const skipped = sessions.filter((s) => s.status === "skipped");
                  const now = Date.now();
                  return (
                    <div className="mt-3 space-y-2">
                      <details>
                        <summary className="cursor-pointer text-sm font-medium">Sessions ({live.length})</summary>
                        {live.length ? <ul className="mt-1 divide-y divide-line">{live.map((s) => <SessionRow key={s.id} s={s} now={now} />)}</ul> : <p className="py-2 text-sm text-muted">No sessions yet.</p>}
                      </details>
                      {skipped.length > 0 && (
                        <details>
                          <summary className="cursor-pointer text-sm text-muted">Skipped ({skipped.length})</summary>
                          <ul className="mt-1 divide-y divide-line">{skipped.map((s) => <SessionRow key={s.id} s={s} now={now} />)}</ul>
                        </details>
                      )}
                    </div>
                  );
                })()}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {notebook ? (
                    <a href={notebook} target="_blank" rel="noopener noreferrer" className={small}>Open notebook</a>
                  ) : (
                    <form action={notebookAction}>
                      <input type="hidden" name="goalId" value={goal.id} />
                      <button type="submit" className={small}>Create Notion notebook</button>
                    </form>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>
    </>
  );
}
