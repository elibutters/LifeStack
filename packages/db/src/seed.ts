import { createDb, events } from "./index";

// Development only: fills a local database with obviously synthetic calendar events so the
// UI has something to show. Refuses to touch anything that is not a local database.
// Times are generated in UTC, so set APP_TZ=UTC locally to see them where written.
const url = process.env.DATABASE_URL ?? "";
let host = "";
try {
  host = new URL(url).hostname;
} catch {}
if (!["127.0.0.1", "localhost"].includes(host)) {
  console.error("seed: refusing to run against a non-local database");
  process.exit(1);
}

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
const at = (dayOffset: number, hour: number, minute = 0) => new Date(today + dayOffset * DAY + (hour * 60 + minute) * 60 * 1000);

type Seed = { title: string; start: Date; end: Date; allDay?: boolean; location?: string };
const list: Seed[] = [];

for (let d = -14; d <= 21; d++) {
  const dow = new Date(today + d * DAY).getUTCDay();
  if (dow >= 1 && dow <= 5) list.push({ title: "Focus block", start: at(d, 9), end: at(d, 11) });
  if (dow === 2 || dow === 4) list.push({ title: "Gym", start: at(d, 17, 30), end: at(d, 18, 30), location: "Example Gym" });
}
list.push(
  { title: "Dinner with friends", start: at(0, 19), end: at(0, 21), location: "Example Restaurant" },
  { title: "Dentist", start: at(2, 14), end: at(2, 15), location: "Example Dental" },
  { title: "Weekend trip", start: at(5, 0), end: at(8, 0), allDay: true },
  { title: "Planning review", start: at(3, 13), end: at(3, 14) },
  { title: "Birthday", start: at(9, 0), end: at(10, 0), allDay: true },
);

const { db, client } = createDb(url, 1);
for (const [i, e] of list.entries()) {
  const row = {
    ts: e.start,
    domain: "calendar",
    key: "calendar.event",
    payload: { title: e.title, end: e.end.toISOString(), allDay: !!e.allDay, ...(e.location ? { location: e.location } : {}) },
    source: "seed",
    sourceId: `seed-${i}`,
  };
  await db.insert(events).values(row).onConflictDoUpdate({ target: [events.source, events.sourceId], set: row });
}
await client.end();
console.log(`seeded ${list.length} synthetic calendar events`);
