// Pure rules for logging sessions, no database.
import { localToDate, statusAt, type SessionStatus } from "./goals-core";

// A time as an agent will write it: with an offset or Z it is exact; with none ("2026-11-11T12:00") it is the owner's own local time, so the
// agent never has to guess the time zone. Returns null when it is not a real time.
export function parseWhen(text: string, tz: string): Date | null {
  const t = text.trim();
  const local = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(t);
  if (local) {
    const [, y, mo, d, h, mi] = local.map(Number) as [number, number, number, number, number, number];
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
    const day = `${local[1]}-${local[2]}-${local[3]}`;
    const out = localToDate(day, h * 60 + mi, tz);
    // 31 February and the like roll over into the next month; refuse them.
    return Number.isNaN(out.getTime()) || new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d ? null : out;
  }
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(t) || !/^\d{4}-\d{2}-\d{2}T/.test(t)) return null;
  const out = new Date(t);
  return Number.isNaN(out.getTime()) ? null : out;
}

export const sessionState = (s: { status: SessionStatus; end: Date }, now: Date): SessionStatus => statusAt(s, now);

// One plain sentence the agent can pass on to the owner.
export function describeMove(a: { title: string; from: Date | null; to: Date; minutes: number; tz: string; wasDone: boolean }): string {
  const f = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: a.tz, weekday: "short", hour: "numeric", minute: "2-digit" }).format(d);
  const verb = a.wasDone ? "Corrected" : "Marked done";
  return a.from
    ? `${verb}: "${a.title}" moved from ${f(a.from)} to ${f(a.to)} and logged as done (${a.minutes} min).`
    : `${verb}: "${a.title}" at ${f(a.to)} (${a.minutes} min).`;
}
