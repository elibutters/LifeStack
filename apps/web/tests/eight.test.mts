import assert from "node:assert/strict";
import { hasSleep, payloadFromDay, rowsFromDay, type SleepDay } from "../lib/eight-map.ts";

const startOfDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

const empty: SleepDay = { day: "2026-10-01" };
assert.equal(hasSleep(empty), false);
assert.equal(rowsFromDay(empty, startOfDay).length, 0);

const night: SleepDay = {
  day: "2026-10-02",
  score: 88,
  presenceStart: "2026-10-02T03:10:00.000Z",
  presenceEnd: "2026-10-02T11:40:00.000Z",
  presenceDuration: 8 * 3600,
  sleepDuration: 7 * 3600 + 12 * 60,
  lightDuration: 3 * 3600,
  deepDuration: 90 * 60,
  remDuration: 2 * 3600,
  tnt: 12,
  sleepQualityScore: { hrv: { current: 41 }, respiratoryRate: { average: 14.2 }, tempBedC: { average: 28.1 } },
  sessions: [
    { id: "nap", startTime: "2026-10-01T21:00:00.000Z", endTime: "2026-10-01T21:20:00.000Z" },
    {
      id: "main",
      startTime: "2026-10-02T03:12:00.000Z",
      endTime: "2026-10-02T11:35:00.000Z",
      stages: [
        { stage: "light", duration: 3600 },
        { stage: "deep", duration: 1800 },
      ],
    },
  ],
};
assert.equal(hasSleep(night), true);
const payload = payloadFromDay(night);
assert.equal(payload.score, 88);
assert.equal(payload.sleepMin, 432);
assert.equal(payload.presenceMin, 480);
assert.equal(payload.bedStart, "2026-10-02T03:12:00.000Z");
assert.equal(payload.hrv, 41);
const rows = rowsFromDay(night, startOfDay);
assert.equal(rows.find((r) => r.key === "sleep.night")?.sourceId, "night:2026-10-02");
assert.equal(rows.find((r) => r.key === "sleep.score")?.valueNum, 88);
assert.equal(rows.find((r) => r.key === "sleep.duration_min")?.valueNum, 432);
assert.equal(rows.every((r) => r.source === "eight"), true);
console.log("eight-map ok");
