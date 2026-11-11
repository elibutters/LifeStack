// The playbook an agent reads on connecting. Pure; run with `pnpm test`.
import assert from "node:assert/strict";
import { buildInstructions } from "../lib/mcp-instructions.ts";

const agent = buildInstructions(["log:write", "log:read", "calendar:read", "goals:read", "goals:write"]);
for (const tool of ["get_tonight", "get_sessions", "get_goal", "complete_session", "log_session", "link_strava_activity", "move_session", "find_free_time", "skip_session", "replace_session", "set_session_note", "add_event", "move_event", "delete_event", "log_event"]) assert.ok(agent.includes(tool), `names ${tool}`);
assert.match(agent, /2026-11-11T12:00/, "shows the local time form");
assert.match(agent, /Do not move_session and then complete_session/, "warns off the two-step");
assert.ok(agent.length < 3000, "stays short enough to read on every connection");

const reader = buildInstructions(["goals:read"]);
assert.ok(reader.includes("get_sessions") && !reader.includes("log_session") && !reader.includes("complete_session"), "a read-only key hears about no write tools");
assert.ok(!buildInstructions(["calendar:read"]).includes("session"), "keys without goal access hear nothing about sessions");
assert.ok(!buildInstructions([]).includes("log_event"), "no scopes, no tool names");
console.log("mcp-instructions tests passed");
