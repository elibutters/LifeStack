import assert from "node:assert/strict";
import { eightSyncDue, hasSleep, payloadFromDay, rowsFromDay, rowsFromRaw, type NightPayload, type SleepDay, type TracePayload } from "../lib/eight-map.ts";

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

const min = 60 * 1000;
const due = { authFailed: false, backfillDone: true, ageMs: min, hasError: false, processing: false, captureStale: false };
assert.equal(eightSyncDue({ ...due, authFailed: true, ageMs: 60 * min, hasError: true, processing: true, captureStale: true }), false);
assert.equal(eightSyncDue(due), false, "a fresh finished night waits");
assert.equal(eightSyncDue({ ...due, ageMs: 10 * min }), false);
assert.equal(eightSyncDue({ ...due, ageMs: 10 * min, processing: true }), true, "a night still scoring is refreshed before the usual wait");
assert.equal(eightSyncDue({ ...due, ageMs: 4 * min, processing: true }), false);
assert.equal(eightSyncDue({ ...due, ageMs: 20 * min }), true);
assert.equal(eightSyncDue({ ...due, backfillDone: false }), true, "backfill keeps going");
assert.equal(eightSyncDue({ ...due, backfillDone: false, hasError: true }), false, "a recent failure waits out the retry");
assert.equal(eightSyncDue({ ...due, captureStale: true }), true, "a mapper change walks history again");

const raw = {
  day: "2026-10-03",
  score: 79,
  sleepDuration: 7 * 3600,
  presenceDuration: 8 * 3600,
  tnt: 4,
  wasoDuration: 600,
  wakeupCount: 2,
  snoreDuration: 900,
  snorePercent: 12,
  heavySnoreDuration: 120,
  heavySnorePercent: 2,
  snoringReductionPercent: 40,
  elevationDuration: 1800,
  sleepQualityScore: { total: 80, heartRate: { current: 52 }, hrv: { current: 41 }, sleepDebt: { dailySleepDebtSeconds: 3600, baselineSleepDurationSeconds: 8 * 3600 } },
  sleepRoutineScore: {
    total: 77,
    latencyAsleepSeconds: { current: 600 },
    latencyOutSeconds: { current: 300 },
    bedtimeConsistency: { score: 70 },
    sleepStartConsistency: { score: 75 },
    wakeupConsistency: { score: 85 },
  },
  performanceWindows: { chronotype: { chronoClass: "intermediate" }, socialJetlag: { socialJetlagSeconds: 1800 } },
  sessions: [
    {
      id: "main",
      startTime: "2026-10-03T03:00:00.000Z",
      endTime: "2026-10-03T11:00:00.000Z",
      stageSummary: { awakeBeforeSleepDuration: 120, awakeBetweenSleepDuration: 300, awakeAfterSleepDuration: 60, outDuration: 0 },
      stages: [{ stage: "deep", duration: 600 }],
      timeseries: {
        heartRate: [["2026-10-03T04:00:00.000Z", 50], ["2026-10-03T05:00:00.000Z", 54]],
        tempBedC: [["2026-10-03T04:00:00.000Z", 28], ["2026-10-03T05:00:00.000Z", 30]],
        heating: [],
      },
    },
  ],
};
const captured = rowsFromRaw(raw, startOfDay);
const stored = captured.find((row) => row.key === "sleep.night")?.payload as NightPayload;
assert.equal(stored.score, 79);
assert.equal(stored.hrAvg, 52);
assert.equal(stored.hrv, 41);
assert.equal(stored.qualityScore, 80);
assert.equal(stored.routineScore, 77);
assert.equal(stored.sleepDebtMin, 60);
assert.equal(stored.baselineSleepMin, 480);
assert.equal(stored.latencyAsleepMin, 10);
assert.equal(stored.latencyOutMin, 5);
assert.equal(stored.bedtimeConsistency, 70);
assert.equal(stored.snoreMin, 15);
assert.equal(stored.wasoMin, 10);
assert.equal(stored.wakeupCount, 2);
assert.equal(stored.elevationMin, 30);
assert.equal(stored.awakeBeforeMin, 2);
assert.equal(stored.chronoClass, "intermediate");
assert.equal(stored.socialJetlagMin, 30);
assert.equal(stored.tempBedC, 29);
const trace = captured.find((row) => row.key === "sleep.trace");
assert.equal(trace?.sourceId, "trace:2026-10-03");
const tracePayload = trace?.payload as TracePayload;
assert.equal(JSON.stringify(tracePayload.detail).includes("timeseries"), false);
assert.equal((tracePayload.series[0]?.series.heartRate as unknown[]).length, 2);
assert.equal(tracePayload.series[0]?.series.heating, undefined);
console.log("eight-map ok");
