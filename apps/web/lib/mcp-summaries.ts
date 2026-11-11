// One plain sentence per write tool, returned next to the data as `summary`, so an agent can tell the owner exactly what changed
// without reading raw JSON, and cannot miss that a calendar update failed. Pure: no database, tested without a server.

type Session = { title: string; start: string; minutes: number; minutesSpent: number | null; rating: number | null; logNote?: string | null; movedFrom: string[]; onCalendar: boolean; actual: { summary: string } | null };
type Cal = string | undefined; // "ok", "skipped" (no event to change), or why Outlook was not updated

const WHY: Record<string, string> = { not_connected: "Outlook is not connected", needs_reconnect: "Outlook needs to be reconnected", failed: "Outlook did not respond" };
const warn = (cal: Cal, what: string) => (cal && cal in WHY ? ` The calendar event was not ${what} (${WHY[cal]}).` : "");

const when = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const name = (s: Session) => `"${s.title}"`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const clock = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const span = (start: string, end: string, tz: string) => `${when(start, tz)} to ${clock(end, tz)}`;
type OneOff = { title: string; start: string; end: string };

export const summaries = {
  // One-off calendar events (no goal).
  addEvent: ({ event }: { event: OneOff }, tz: string) => `Added "${event.title}" to your calendar for ${span(event.start, event.end, tz)}.`,
  moveEvent: ({ event, was }: { event: OneOff; was: { start: string; end: string } }, tz: string) => `Moved "${event.title}" from ${when(was.start, tz)} to ${span(event.start, event.end, tz)}.`,
  removeEvent: ({ removed }: { removed: OneOff }, tz: string) => `Removed "${removed.title}" (${span(removed.start, removed.end, tz)}) from your calendar.`,
  deleteGoal: ({ deleted, notebook }: { deleted: { title: string; sessions: number; finished: number; calendarEvents: number }; notebook: string | null }) =>
    `Deleted the goal "${deleted.title}" and its ${plural(deleted.sessions, "session")}${deleted.finished ? ` (${deleted.finished} finished)` : ""}` +
    `${deleted.calendarEvents ? `, and removed ${plural(deleted.calendarEvents, "calendar event")}` : ""}.` +
    (notebook ? ` Its Notion notebook was left alone; delete that page by hand if you want it gone: ${notebook}` : ""),
  complete: ({ session: s }: { session: Session }) =>
    `Marked ${name(s)} done (${s.minutesSpent ?? s.minutes} min${s.rating ? `, rated ${s.rating}/5` : ""}${s.logNote ? ", with a note" : ""}).`,

  skip: ({ session: s, calendar }: { session: Session; calendar?: Cal }, tz: string) =>
    `Skipped ${name(s)} (it was planned for ${when(s.start, tz)}); it stays in the record as skipped and is off the calendar.${warn(calendar, "removed")}`,

  replace: ({ session: s, calendar }: { session: Session; calendar?: Cal }) =>
    `Dropped ${name(s)} because the plan changed; it is not counted as skipped.${warn(calendar, "removed")}`,

  move: ({ session: s, calendar }: { session: Session; calendar?: Cal }, tz: string) => {
    const from = s.movedFrom.at(-1);
    return `Moved ${name(s)}${from ? ` from ${when(from, tz)}` : ""} to ${when(s.start, tz)}.${calendar === "ok" ? " Its calendar event moved too." : calendar === "skipped" ? " It has no calendar event." : warn(calendar, "moved")}`;
  },

  note: ({ session: s, calendar }: { session: Session; calendar?: Cal }) =>
    `Updated the note on ${name(s)}${calendar === "ok" ? " and its calendar event" : ""}.${warn(calendar, "updated")}`,

  link: ({ session: s, completed, calendar }: { session: Session; completed?: boolean; calendar?: Cal }) =>
    (s.actual
      ? `Linked the Strava activity (${s.actual.summary}) to ${name(s)}${completed ? " and marked it done" : ""}.`
      : `Unlinked the Strava activity from ${name(s)}.`) + warn(calendar, "updated"),

  commit: ({ saved, replaced, calendar }: { saved: number; replaced?: number; calendar?: Cal }) =>
    `Saved ${plural(saved, "session")}${replaced ? ` and replaced ${plural(replaced, "earlier one")}` : ""}${calendar === "ok" ? ", all on the calendar" : ""}.` +
    (calendar && calendar in WHY ? ` None reached the calendar (${WHY[calendar]}); push_to_calendar adds them once that is fixed.` : ""),

  push: ({ pushed, calendar }: { pushed: number; calendar?: Cal }) =>
    calendar && calendar in WHY ? `Nothing was added to the calendar (${WHY[calendar]}).` : pushed === 0 ? "Every saved session is already on the calendar." : `Added ${plural(pushed, "session")} to the calendar.`,
};
