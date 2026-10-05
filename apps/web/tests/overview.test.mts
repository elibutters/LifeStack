// Compact today/week digests. No database needed. Run with `pnpm test`.
import assert from "node:assert/strict";
import { summarizeToday } from "../lib/capture-core.ts";
import { logDigest, sleepDigest, summarizeWeek } from "../lib/overview-core.ts";

const ts = (iso: string) => new Date(iso);
const E = (id: number, iso: string, key: string, v: number | null, t: string | null) => ({
  id, ts: ts(iso), key, valueNum: v, valueText: t, source: "manual",
});

const sum = summarizeToday([
  E(1, "2026-10-10T13:00:00Z", "mood", 4, null),
  E(2, "2026-10-10T14:00:00Z", "caffeine", 75, "Coffee"),
  E(3, "2026-10-10T15:00:00Z", "supplement.taken", 22, "Zinc"),
]);
const d = logDigest(sum);
assert.equal(d.mood!.value, 4);
assert.equal(d.caffeine.mg, 75);
assert.equal(d.supplements[0]!.name, "Zinc");
assert.equal(sleepDigest(undefined), null);
assert.deepEqual(sleepDigest({ day: "2026-10-09", score: 82, sleepMin: 410 }), { day: "2026-10-09", score: 82, sleepMin: 410, deepMin: null, remMin: null });

const week = summarizeWeek({
  from: "2026-10-04",
  to: "2026-10-10",
  days: [
    { day: "2026-10-08", summary: summarizeToday([E(1, "2026-10-08T12:00:00Z", "mood", 2, null)]) },
    { day: "2026-10-10", summary: sum },
  ],
  nights: [{ day: "2026-10-09", score: 80, sleepMin: 400 }, { day: "2026-10-10", score: 90, sleepMin: 420 }],
  eventCount: 3,
  spending: 120.4,
});
assert.equal(week.mood!.avg, 3);
assert.equal(week.mood!.days, 2);
assert.equal(week.caffeineMg, 75);
assert.equal(week.supplementDays, 1);
assert.equal(week.sleep!.avgScore, 85);
assert.equal(week.sleep!.avgSleepMin, 410);
assert.equal(week.events, 3);
assert.equal(week.spending, 120.4);

console.log("OVERVIEW OK");
