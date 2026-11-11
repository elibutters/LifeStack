// Pure rules for one-off calendar events (a call, an appointment, an errand: things that belong to no goal). No database here.
import { parseWhen } from "./session-log-core";

export const ONEOFF_DEFAULT_MIN = 30;
export const ONEOFF_MAX_MIN = 12 * 60;
const DAY = 86_400_000;

export type Window = { start: Date; end: Date };

// Works out when an event is from what an agent gives: a start (local time with no offset, or with one), and either an end or a length in
// minutes (default 30). Returns the window or a plain reason it cannot be one.
export function resolveWindow(input: { start: string; end?: string; minutes?: number }, tz: string, now: Date): { ok: true; window: Window } | { ok: false; error: string } {
  const start = parseWhen(input.start, tz);
  if (!start) return { ok: false, error: "start is not a valid time. Use an ISO time with an offset (2026-11-11T17:00:00-05:00), or a local time with no offset (2026-11-11T17:00) which counts as the owner's own time zone." };
  let end: Date | null;
  if (input.end !== undefined) {
    end = parseWhen(input.end, tz);
    if (!end) return { ok: false, error: "end is not a valid time. Use the same forms as start, or give minutes instead." };
  } else {
    const min = input.minutes ?? ONEOFF_DEFAULT_MIN;
    if (!Number.isFinite(min) || min < 1) return { ok: false, error: "minutes must be at least 1." };
    end = new Date(start.getTime() + min * 60_000);
  }
  if (!(end.getTime() > start.getTime())) return { ok: false, error: "The event ends before it starts." };
  if ((end.getTime() - start.getTime()) / 60_000 > ONEOFF_MAX_MIN) return { ok: false, error: "An event can be at most 12 hours long." };
  if (start.getTime() < now.getTime() - 30 * DAY) return { ok: false, error: "That is more than 30 days in the past." };
  if (start.getTime() > now.getTime() + 400 * DAY) return { ok: false, error: "That is more than a year away." };
  return { ok: true, window: { start, end } };
}

export type Blocker = { start: Date; end: Date; what: string };

// What a window runs into, if anything: each blocker that overlaps it.
export function clashes(w: Window, blockers: Blocker[]): { with: string; start: string; end: string }[] {
  return blockers.filter((b) => w.start < b.end && w.end > b.start).map((b) => ({ with: b.what, start: b.start.toISOString(), end: b.end.toISOString() }));
}
