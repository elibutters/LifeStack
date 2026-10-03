// Date helpers that work in the owner's timezone (APP_TZ) without a date library.
// Days are plain "YYYY-MM-DD" strings; months are "YYYY-MM".
function validTz(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    console.error(`APP_TZ "${tz}" is not a valid IANA timezone; using UTC`);
    return "UTC";
  }
}

export const TZ = validTz(process.env.APP_TZ || "UTC");

const pad = (n: number) => String(n).padStart(2, "0");

function parseYmd(s: string): [number, number, number] {
  const [y, m, d] = s.split("-").map(Number);
  return [y!, m!, d!];
}

const partsFormat = new Map<string, Intl.DateTimeFormat>();

function tzParts(d: Date, tz: string) {
  let fmt = partsFormat.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormat.set(tz, fmt);
  }
  const parts = fmt.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

export function ymd(d: Date, tz = TZ): string {
  const p = tzParts(d, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function hourOf(d: Date, tz = TZ): number {
  return tzParts(d, tz).h;
}

function offsetMs(d: Date, tz: string): number {
  const p = tzParts(d, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(d.getTime() / 1000) * 1000;
}

// The instant a given calendar day starts in the timezone. Two passes handle DST changes.
export function startOfDay(day: string, tz = TZ): Date {
  const [y, m, d] = parseYmd(day);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz);
  // Some zones skip local midnight on a DST day; the day then starts at the first real hour.
  for (let i = 0; i < 4 && ymd(new Date(t), tz) < day; i++) t += 60 * 60 * 1000;
  return new Date(t);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = parseYmd(day);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export const isValidDay = (s: string | undefined): s is string =>
  !!s && /^(19[7-9]\d|[2-9]\d{3})-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;

export const isValidMonth = (s: string | undefined): s is string =>
  !!s && /^(19[7-9]\d|[2-9]\d{3})-(0[1-9]|1[0-2])$/.test(s);

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = parseYmd(`${month}-01`);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}`;
}

// Whole weeks (Sunday first) covering the month, as day strings.
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const [y, m] = parseYmd(first);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const total = Math.ceil((lead + days) / 7) * 7;
  return Array.from({ length: total }, (_, i) => addDays(first, i - lead));
}

const utcDate = (day: string) => new Date(Date.UTC(...(parseYmd(day).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number])));

export const fmtTime = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(d);

export const fmtMonth = (month: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(utcDate(`${month}-01`));

export const fmtDayLong = (day: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(utcDate(day));

export const fmtDayShort = (day: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(utcDate(day));

export const fmtDateTime = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
