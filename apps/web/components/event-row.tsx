import type { CalendarItem } from "@/lib/calendar";
import { fmtDayShort, fmtTime, ymd } from "@/lib/dates";

export function EventRow({ item, showDate = false }: { item: CalendarItem; showDate?: boolean }) {
  const when = showDate ? fmtDayShort(ymd(item.start)) : item.allDay ? "All day" : fmtTime(item.start);
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
