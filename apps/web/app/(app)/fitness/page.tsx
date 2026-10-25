import type { Metadata } from "next";
import { after } from "next/server";
import { Card } from "@/components/card";
import { requireSession } from "@/lib/auth";
import { syncPlanHorizon, listSlots } from "@/lib/fitness-plan";
import { fmtClock, fmtLength, WEEKDAYS, type PlanSlot } from "@/lib/fitness-plan-core";
import { addPlanItem, removePlanItem } from "./actions";

export const metadata: Metadata = { title: "Plan" };
export const dynamic = "force-dynamic";

const input = "h-9 w-full min-w-0 rounded-md border border-line bg-bg px-2.5 text-sm text-fg outline-none focus:border-accent";

const when = (s: PlanSlot) => (s.startMin == null ? "All day" : `${fmtClock(s.startMin)} · ${fmtLength(s.durationMin ?? 60)}`);

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireSession();
  after(syncPlanHorizon);
  const sp = await searchParams;
  const slots = await listSlots().catch(() => [] as PlanSlot[]);
  const days = WEEKDAYS.map((d) => ({ ...d, items: slots.filter((s) => s.weekday === d.id) }));

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-muted">
        The same week repeats. Workouts and prep show on the calendar from today through the next eight weeks. Changing an item updates today and later; days already past stay as they were.
      </p>
      {sp.error === "invalid" && (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-danger">
          That did not look right. A title is required, time is optional (like 07:30), and length is minutes up to 12 hours.
        </p>
      )}
      {sp.error === "sync" && (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-danger">Couldn't update the plan. Try again shortly.</p>
      )}
      <Card title="Add to the week">
        <form action={addPlanItem} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select name="weekday" aria-label="Day" defaultValue="0" className={input}>
            {WEEKDAYS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          <select name="kind" aria-label="Kind" defaultValue="workout" className={input}>
            <option value="workout">Workout</option>
            <option value="prep">Prep</option>
          </select>
          <input name="title" required maxLength={80} placeholder="Easy run, meal prep…" aria-label="Title" className={`${input} col-span-2`} />
          <input name="time" type="time" aria-label="Start time" className={input} />
          <input name="duration" inputMode="numeric" maxLength={3} placeholder="Minutes" aria-label="Length in minutes" className={input} />
          <input name="notes" maxLength={280} placeholder="Note (route, what to prep)" aria-label="Note" className={`${input} col-span-2 sm:col-span-4`} />
          <button type="submit" className="col-span-2 h-9 rounded-md bg-fg px-4 text-sm font-medium text-bg sm:col-span-4">
            Add to the week
          </button>
        </form>
        <p className="mt-2 text-xs text-muted">Leave the time empty for an all-day item. A time with no length is one hour.</p>
      </Card>
      <ol className="space-y-3">
        {days.map((d) => (
          <li key={d.id} className="rounded-md border border-line bg-surface">
            <div className="flex items-baseline justify-between px-4 pt-3 pb-1">
              <h2 className="text-lg font-semibold tracking-tight">{d.label}</h2>
              <span className="text-sm tabular-nums text-muted">{d.items.length ? `${d.items.length}` : ""}</span>
            </div>
            {d.items.length ? (
              <ul className="divide-y divide-line px-4 pb-2">
                {d.items.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {s.title}
                        <span className={`ml-2 rounded-sm px-1.5 py-0.5 text-xs font-normal ${s.kind === "workout" ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"}`}>
                          {s.kind === "workout" ? "Workout" : "Prep"}
                        </span>
                      </p>
                      <p className="mt-0.5 text-sm text-muted">{when(s)}{s.notes ? ` · ${s.notes}` : ""}</p>
                    </div>
                    <form action={removePlanItem} className="shrink-0">
                      <input type="hidden" name="id" value={s.id} />
                      <button type="submit" aria-label={`Remove ${s.title}`} className="h-7 rounded-md border border-line px-2 text-xs text-muted hover:bg-raised hover:text-fg">
                        Remove
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 pb-3 text-sm text-muted">Nothing planned.</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
