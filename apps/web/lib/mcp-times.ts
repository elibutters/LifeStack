// Makes times in tool answers unambiguous for an agent. Timestamps are stored and returned in UTC ("...Z"), which an agent has to
// convert to the owner's clock by guessing the zone. Every timestamp under a few known keys therefore gets a sibling with the
// owner's local time and its UTC offset ("2026-11-11T10:05:30-05:00"). All-day dates (YYYY-MM-DD) are left alone. Pure, so tested without a server.

// Local wall-clock time with offset for an instant, in an IANA zone.
export function localIso(d: Date, tz: string): string {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  const off = Math.round((wall - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const sign = off < 0 ? "-" : "+", abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0"), mm = String(abs % 60).padStart(2, "0");
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${hh}:${mm}`;
}

const KEYS = ["start", "end", "doneAt", "at", "lastAt"] as const;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/;

// Returns a copy of `value` where each of those keys holding a UTC timestamp has a `<key>Local` sibling. A `startLocal` that came
// from the source (Strava labels its wall-clock time with a Z) is replaced by the real local time.
export function addLocalTimes(value: unknown, tz: string): unknown {
  if (Array.isArray(value)) return value.map((v) => addLocalTimes(v, tz));
  if (value === null || typeof value !== "object" || value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = addLocalTimes(v, tz);
  for (const k of KEYS) {
    const v = (value as Record<string, unknown>)[k];
    if (typeof v === "string" && UTC.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) out[`${k}Local`] = localIso(d, tz);
    }
  }
  return out;
}
