import assert from "node:assert/strict";
const u = await import("../lib/mcp-usage-core.ts");
const at = (m: number) => new Date(Date.UTC(2026, 9, 25, 12, m));
const c = (tool: string, m: number, o: Partial<import("../lib/mcp-usage-core.ts").Call> = {}) => ({ at: at(m), tool, tokenId: 1, ms: 100, outcome: "ok" as const, bytes: 500, argKeys: [], ...o });

const calls = [c("get_goals", 0), c("get_goal", 1), c("get_goals", 2), c("propose_plan", 3, { outcome: "invalid", error: "Invalid arguments at title", argKeys: ["kind"], ms: 5 }), c("propose_plan", 4, { ms: 900, bytes: 9000 }), c("get_goals", 60, { tokenId: 2 })];
const s = u.toolStats(calls);
assert.deepEqual(s.map((x) => [x.tool, x.calls]), [["get_goals", 3], ["propose_plan", 2], ["get_goal", 1]]);
const pp = s.find((x) => x.tool === "propose_plan")!;
assert.equal(pp.errors, 1); assert.equal(pp.errorRate, 0.5); assert.equal(pp.maxBytes, 9000);
assert.deepEqual(u.commonErrors(calls).map((e) => [e.tool, e.count, e.argKeys]), [["propose_plan", 1, ["kind"]]]);
assert.deepEqual(u.repeats(calls), [{ tool: "get_goals", count: 1 }, { tool: "propose_plan", count: 1 }], "same key, same tool, within five minutes");
assert.deepEqual(u.sequences(calls)[0], { from: "get_goals", to: "get_goal", count: 1 });
assert.deepEqual(u.unused(["get_goals", "get_tonight", "a_tool"], calls), ["a_tool", "get_tonight"]);

// reading the server's answer
assert.deepEqual(u.outcomeOf({ result: { content: [{ type: "text", text: "[]" }] } }), { outcome: "ok", bytes: 2 });
assert.equal(u.outcomeOf({ error: { message: "bad" } }).outcome, "invalid");
assert.equal(u.outcomeOf({ result: { isError: true, content: [{ type: "text", text: "MCP error -32602: Input validation error: Invalid arguments for tool x: expected string at title" }] } }).outcome, "invalid");
assert.equal(u.outcomeOf({ result: { isError: true, content: [{ type: "text", text: "The tool could not read the data." }] } }).outcome, "tool_error");
assert.equal(u.outcomeOf({ result: { isError: true, content: [{ type: "text", text: "Tool nope not found" }] } }).outcome, "unknown_tool");
console.log("mcp-usage-core: ok");
