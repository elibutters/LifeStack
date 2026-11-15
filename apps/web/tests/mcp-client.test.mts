// Telling agents apart on one shared key: the client label and runs. Pure; run with `pnpm test`.
import assert from "node:assert/strict";
import { clientOf, runsOf, type Call } from "../lib/mcp-usage-core.ts";

// ---- labels from the User-Agent
assert.equal(clientOf(null), "unknown"); assert.equal(clientOf(""), "unknown"); assert.equal(clientOf("   "), "unknown");
assert.equal(clientOf("claude-code/2.1.0 (cli)"), "Claude Code");
assert.equal(clientOf("Claude Code/1.0"), "Claude Code");
assert.equal(clientOf("Cursor/1.7 (darwin arm64)"), "Cursor");
assert.equal(clientOf("Claude-User"), "Claude chat");
assert.equal(clientOf("Mozilla/5.0 (compatible; Anthropic-MCP/1.0)"), "Claude chat");
assert.equal(clientOf("ChatGPT-User/1.0"), "ChatGPT"); assert.equal(clientOf("openai-mcp/1"), "ChatGPT");
assert.equal(clientOf("curl/8.4.0"), "curl");
assert.equal(clientOf("python-httpx/0.27"), "python-httpx", "an unknown client keeps its first word so it can still be told apart");
assert.equal(clientOf("SomeVeryLongClientNameThatKeepsGoingAndGoingForever/1"), "someverylongclientnamethatkeepsg".slice(0, 30), "capped at 30 characters");

// ---- runs: one burst of work per key and client
const at = (min: number, sec = 0) => new Date(Date.UTC(2026, 10, 11, 21, min, sec));
const c = (tool: string, min: number, client: string | undefined, tokenId = 20, o: Partial<Call> = {}): Call => ({ at: at(min), tool, tokenId, ms: 100, outcome: "ok", bytes: 10, argKeys: [], client, ...o });
const calls: Call[] = [
  c("get_today", 17, "Claude Code"), c("update_todo", 17, "Claude Code"),                         // my pulse tests
  c("get_sessions", 22, "Claude chat"), c("log_session", 22, "Claude chat"),                       // your chat, same key, same minutes as mine below
  c("update_todo", 22, "Claude Code"),
  c("get_goals", 47, "Claude chat"), c("add_event", 47, "Claude chat"), c("move_event", 48, "Claude chat", 20, { outcome: "tool_error", ms: 300 }),
  c("get_goals", 47, undefined, 21),                                                               // an old row: no client, another key
];
const runs = runsOf(calls);
assert.deepEqual(runs.map((r) => [r.client, r.tokenId, r.tools.join(">")]), [
  ["Claude chat", 20, "get_goals>add_event>move_event"],
  ["unknown", 21, "get_goals"],
  ["Claude chat", 20, "get_sessions>log_session"],        // 21:22: the same key and minute as Claude Code's call below, split by program
  ["Claude Code", 20, "get_today>update_todo>update_todo"], // 21:17 and 21:22 are five minutes apart: one run
], "newest first; one run per key and program");
const last = runs[0]!; assert.equal(last.calls, 3); assert.equal(last.errors, 1); assert.equal(last.ms, 500); assert.equal(last.start.getTime(), at(47).getTime()); assert.equal(last.end.getTime(), at(48).getTime());

// ---- a gap longer than ten minutes starts a new run for the same program
const two = runsOf([c("a", 0, "Cursor"), c("b", 5, "Cursor"), c("c", 30, "Cursor")]);
assert.deepEqual(two.map((r) => r.tools.join(">")), ["c", "a>b"]);
assert.deepEqual(runsOf([]), []);
assert.equal(runsOf([c("a", 0, "Cursor"), c("b", 20, "Cursor")], 30 * 60_000).length, 1, "the gap is adjustable");
console.log("mcp-client tests passed");
