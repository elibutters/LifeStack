// The one-sentence summaries returned by the write tools. Pure; run with `pnpm test`.
import assert from "node:assert/strict";
import { summaries as S } from "../lib/mcp-summaries.ts";

const NY = "America/New_York";
const sess = (o: Record<string, unknown> = {}) => ({ title: "Lower (heavy)", start: "2026-11-11T17:00:00.000Z", minutes: 60, minutesSpent: null, rating: null, logNote: null, movedFrom: [], onCalendar: true, actual: null, ...o }) as any;

assert.equal(S.complete({ session: sess() }), 'Marked "Lower (heavy)" done (60 min).');
assert.equal(S.complete({ session: sess({ minutesSpent: 70, rating: 4, logNote: "good" }) }), 'Marked "Lower (heavy)" done (70 min, rated 4/5, with a note).');

assert.equal(S.skip({ session: sess(), calendar: "ok" }, NY), 'Skipped "Lower (heavy)" (it was planned for Wed 12:00 PM); it stays in the record as skipped and is off the calendar.');
assert.match(S.skip({ session: sess(), calendar: "needs_reconnect" }, NY), /The calendar event was not removed \(Outlook needs to be reconnected\)\.$/, "a failed calendar update is stated plainly");
assert.ok(!/calendar event was not/.test(S.skip({ session: sess(), calendar: "skipped" }, NY)), "no event, nothing to warn about");

assert.equal(S.replace({ session: sess(), calendar: "ok" }), 'Dropped "Lower (heavy)" because the plan changed; it is not counted as skipped.');

assert.equal(S.move({ session: sess({ movedFrom: ["2026-11-10T23:30:00.000Z"] }), calendar: "ok" }, NY), 'Moved "Lower (heavy)" from Tue 6:30 PM to Wed 12:00 PM. Its calendar event moved too.');
assert.equal(S.move({ session: sess(), calendar: "skipped" }, NY), 'Moved "Lower (heavy)" to Wed 12:00 PM. It has no calendar event.');
assert.match(S.move({ session: sess(), calendar: "failed" }, NY), /The calendar event was not moved \(Outlook did not respond\)\.$/);

assert.equal(S.note({ session: sess(), calendar: "ok" }), 'Updated the note on "Lower (heavy)" and its calendar event.');
assert.equal(S.note({ session: sess(), calendar: "skipped" }), 'Updated the note on "Lower (heavy)".');
assert.match(S.note({ session: sess(), calendar: "not_connected" }), /The calendar event was not updated \(Outlook is not connected\)\.$/);

assert.equal(S.link({ session: sess({ actual: { summary: "7.0 mi in 1h10" } }), completed: true, calendar: "ok" }), 'Linked the Strava activity (7.0 mi in 1h10) to "Lower (heavy)" and marked it done.');
assert.equal(S.link({ session: sess({ actual: { summary: "7.0 mi" } }), completed: false, calendar: "ok" }), 'Linked the Strava activity (7.0 mi) to "Lower (heavy)".');
assert.equal(S.link({ session: sess(), completed: false, calendar: "ok" }), 'Unlinked the Strava activity from "Lower (heavy)".');

assert.equal(S.commit({ saved: 3, replaced: 0, calendar: "ok" }), "Saved 3 sessions, all on the calendar.");
assert.equal(S.commit({ saved: 1, replaced: 2, calendar: "ok" }), "Saved 1 session and replaced 2 earlier ones, all on the calendar.");
assert.match(S.commit({ saved: 2, calendar: "needs_reconnect" }), /^Saved 2 sessions\. None reached the calendar \(Outlook needs to be reconnected\); push_to_calendar adds them once that is fixed\.$/);

assert.equal(S.push({ pushed: 2, calendar: "ok" }), "Added 2 sessions to the calendar.");
assert.equal(S.push({ pushed: 0, calendar: "ok" }), "Every saved session is already on the calendar.");
assert.equal(S.push({ pushed: 0, calendar: "not_connected" }), "Nothing was added to the calendar (Outlook is not connected).");
console.log("mcp-summaries tests passed");
