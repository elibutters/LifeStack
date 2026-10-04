import type { CalendarItem } from "@/lib/calendar";
import { fmtDayShort, fmtTime, startOfDay, ymd } from "@/lib/dates";

// `day` is the day being listed; an event that began earlier is shown as continuing.
export function EventRow({ item, day, showDate = false }: { item: CalendarItem; day?: string; showDate?: boolean }) {
  const holiday = item.kind === "holiday";
  const continues = !!day && item.start < startOfDay(day);
  const when = showDate
    ? fmtDayShort(ymd(item.start))
    : item.allDay
      ? "All day"
      : continues
        ? "Continues"
        : fmtTime(item.start);
  const detail = [
    showDate && !item.allDay ? fmtTime(item.start) : null,
    holiday ? "Holiday" : null,
    item.location ?? null,
  ]
    .filter(Boolean)
    .join(" \u00b7 ");
  return (
    <li className="flex gap-3 py-2.5">
      <span className="w-20 shrink-0 pt-0.5 text-sm text-muted tabular-nums">{when}</span>
      <span aria-hidden="true" className={`mt-2 h-2 w-2 shrink-0 rounded-full ${holiday ? "bg-holiday" : "bg-accent"}`} />
      <div>
        <p className="whitespace-nowrap">{item.title}</p>
        {detail && <p className="whitespace-nowrap text-sm text-muted">{detail}</p>}
      </div>
    </li>
  );
}
