import type { CalendarItem } from "@/lib/calendar";
import { fmtDayShort, fmtTime, startOfDay, ymd } from "@/lib/dates";

// `day` is the day being listed; an event that began earlier is shown as continuing.
export function EventRow({ item, day, showDate = false }: { item: CalendarItem; day?: string; showDate?: boolean }) {
  const continues = !!day && item.start < startOfDay(day);
  const when = showDate
    ? fmtDayShort(ymd(item.start))
    : item.allDay
      ? "All day"
      : continues
        ? "Continues"
        : fmtTime(item.start);
  return (
    <li className="flex gap-3 py-2.5">
      <span className="w-20 shrink-0 pt-0.5 text-sm text-muted tabular-nums">{when}</span>
      <div className="min-w-0">
        <p className="truncate">{item.title}</p>
        <p className="truncate text-sm text-muted">
          {showDate && !item.allDay ? `${fmtTime(item.start)}${item.location ? " · " : ""}` : ""}
          {item.location ?? ""}
        </p>
      </div>
    </li>
  );
}
