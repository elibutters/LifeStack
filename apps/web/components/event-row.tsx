import type { CalendarItem } from "@/lib/calendar";
import type { SessionDetail } from "@/lib/calendar-sessions";
import { fmtDayShort, fmtTime, startOfDay, ymd } from "@/lib/dates";

export function eventTone(kind: CalendarItem["kind"]) {
  if (kind === "holiday") return { chip: "bg-holiday/15 text-holiday", dot: "bg-holiday", label: "Holiday" };
  if (kind === "workout") return { chip: "bg-ok/15 text-ok", dot: "bg-ok", label: "Workout" };
  if (kind === "prep") return { chip: "bg-warn/15 text-warn", dot: "bg-warn", label: "Prep" };
  return { chip: "bg-fg/10 text-fg", dot: "bg-fg/55", label: null as string | null };
}

// `day` is the day being listed; an event that began earlier is shown as continuing.
const STATUS_TONE: Record<string, string> = { done: "bg-ok/15 text-ok", skipped: "bg-fg/10 text-muted", planned: "bg-warn/15 text-warn" };

// What the goal knows about a calendar item that is one of its sessions. The goal and the status sit together at the top right of the row, the goal just left of the status; the note and
// the linked run share one line underneath.
export function SessionTag({ session }: { session: SessionDetail }) {
  return (
    <span className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
      {session.goal && <span className="text-xs text-muted">{session.goal}</span>}
      <span className={`rounded-sm px-1.5 py-0.5 text-xs capitalize ${STATUS_TONE[session.status] ?? STATUS_TONE.planned}`}>{session.status}</span>
    </span>
  );
}

// Two sections, each free to run to several lines and divided from one another: the plan (the note), then what actually happened with the
// Strava link at the bottom right.
export function SessionBody({ note, actual }: { note: string | null; actual: SessionDetail["actual"] }) {
  if (!note && !actual) return null;
  return (
    <div className="mt-1.5 whitespace-normal text-sm">
      {note && (
        <div className="grid grid-cols-[3.25rem_1fr] gap-x-2 py-1.5">
          <span className="text-xs text-muted">Plan</span>
          <p className="whitespace-pre-line">{note}</p>
        </div>
      )}
      {actual && (
        <div className={`grid grid-cols-[3.25rem_1fr] gap-x-2 py-1.5 ${note ? "border-t border-line" : ""}`}>
          <span className="text-xs text-muted">Actual</span>
          <div className="flex items-end justify-between gap-3">
            <p className="whitespace-pre-line">{actual.summary.replace(/^Actual: /, "").replace(/ \(Strava\)$/, "")}</p>
            <a href={actual.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-accent">Strava</a>
          </div>
        </div>
      )}
    </div>
  );
}

export function EventRow({ item, day, showDate = false, session }: { item: CalendarItem; day?: string; showDate?: boolean; session?: SessionDetail }) {
  const tone = eventTone(item.kind);
  const continues = !!day && item.start < startOfDay(day);
  const when = showDate
    ? fmtDayShort(ymd(item.start))
    : item.allDay
      ? "All day"
      : continues
        ? "Continues"
        : fmtTime(item.start);
  const detail = [showDate && !item.allDay ? fmtTime(item.start) : null, tone.label, item.detail ?? null, item.location ?? null].filter(Boolean).join(" \u00b7 ");
  return (
    <li className="flex gap-3 py-2.5">
      <span className="w-20 shrink-0 pt-0.5 text-sm text-muted tabular-nums">{when}</span>
      <span aria-hidden="true" className={`mt-2 h-2 w-2 shrink-0 rounded-sm ${tone.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="whitespace-nowrap">{item.title}</p>
          {session && <SessionTag session={session} />}
        </div>
        {detail && <p className="whitespace-nowrap text-sm text-muted">{detail}</p>}
        {session && <SessionBody note={session.note} actual={session.actual} />}
      </div>
    </li>
  );
}
