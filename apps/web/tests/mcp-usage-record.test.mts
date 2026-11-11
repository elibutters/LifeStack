// Recording MCP calls in the order production runs them: the response is sent (its body consumed) before the recording runs. Run with `pnpm test`.
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
const { db } = await import("../lib/db.ts");
const { events } = await import("@lifestack/db");
const { recordCalls } = await import("../lib/mcp-usage.ts");

await db().delete(events);
const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "log_session", arguments: { id: "abc", start: "2026-11-11T12:00" } } };
const answer = () => Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] } });

// What went wrong: copying the response after it was sent fails, and the failure was swallowed, so nothing was ever recorded.
const sent = answer();
await sent.text();
assert.throws(() => sent.clone(), /consumed|used|locked/i, "a response cannot be cloned once its body has been read");

// The handler now copies the response before returning it, so the recording can read its own copy after the original is gone.
const res = answer();
const forLog = res.clone();
await res.text(); // the platform sends the response first
await recordCalls(body, forLog, 7, Date.now() - 12);
const rows = (await db().select().from(events)).filter((e) => e.source === "mcp");
assert.equal(rows.length, 1, "the call was recorded");
assert.equal(rows[0]!.valueText, "log_session");
assert.deepEqual((rows[0]!.payload as any).argKeys, ["id", "start"], "argument names are kept, never values");
assert.equal((rows[0]!.payload as any).outcome, "ok");
assert.equal((rows[0]!.payload as any).tokenId, 7);
assert.ok(!JSON.stringify(rows[0]).includes("2026-11-11T12:00"), "no argument value is stored");

// ---- the caller's signature is kept, as a label and the short raw string, so agents on one key can be told apart
await db().delete(events);
const ua = "claude-code/2.1.0 (cli)";
const res2 = answer(); const forLog2 = res2.clone(); await res2.text();
await recordCalls(body, forLog2, 20, Date.now() - 5, ua);
await recordCalls(body, answer(), 20, Date.now() - 5); // an older caller that sent none
const withUa = (await db().select().from(events)).filter((e) => e.source === "mcp").map((e) => e.payload as any);
assert.deepEqual(withUa.map((p) => [p.client, p.ua ?? null]).sort(), [["Claude Code", ua], ["unknown", null]]);

await db().delete(events);
console.log("mcp-usage-record tests passed");
