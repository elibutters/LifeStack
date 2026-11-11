// The short playbook the MCP server hands every agent when it connects (the protocol's `instructions`).
// It is built from the key's scopes, so an agent is never told about a tool it was not given. Keep it brief:
// it is read on every connection, and the per-tool descriptions carry the detail. Pure, so it is tested without a server.
import type { Scope } from "./capture-core";

export function buildInstructions(scopes: readonly string[]): string {
  const has = (s: Scope) => scopes.includes(s);
  const out: string[] = [
    "Life Stack holds the owner's own calendar, sleep, finances, daily log and goals. Read before you write, and tell the owner plainly what you changed. When a write tool returns a summary, pass it on.",
  ];

  if (has("goals:read") || has("goals:write")) {
    out.push(
      [
        "Goal sessions (workouts, study blocks, anything planned toward a goal):",
        "- To see today, or what slipped and needs a decision: get_tonight. To find a session's id by day or name: get_sessions (short rows, with state planned, done, skipped or missed). get_goal shows one whole goal.",
        ...(has("goals:write")
          ? [
              "- Pick the write tool by what happened:",
              "  - Done at its planned time: complete_session.",
              "  - Done earlier, later or at a different time than planned (including a missed session done late, or a lift done at noon that was planned for the evening): log_session with the real start. A start with no offset (2026-11-11T12:00) is the owner's own local time. Do not move_session and then complete_session; log_session does both and never refuses an overlap.",
              "  - A run or ride that Strava recorded: Life Stack pairs it with its session after each sync, so check get_sessions first. If it was missed or paired wrongly, link_strava_activity with the id from get_activities.",
              "  - Planned for a different time that has not happened yet: move_session (it refuses overlaps; find_free_time shows what is open).",
              "  - The owner chose not to do it: skip_session. The plan changed and it is no longer wanted: replace_session (or commit_plan's replaces). Never skip a session in order to reschedule it.",
              "- Add detail or comments to a session with set_session_note.",
            ]
          : []),
      ].join("\n"),
    );
  }

  if (has("log:write")) {
    out.push("Mood, caffeine and supplements are recorded with log_event, one entry per thing taken or felt.");
  }
  return out.join("\n\n");
}
