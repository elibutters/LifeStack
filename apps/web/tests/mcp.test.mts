// MCP server: auth, scope filtering and tool calls over the HTTP handler. Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
process.env.APP_TZ = "UTC";
const { WebStandardStreamableHTTPServerTransport: T } = await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");
const { handleMcp } = await import("../lib/mcp-http.ts"); const tok = await import("../lib/tokens.ts"); const { AGENT_SCOPES } = await import("../lib/capture-core.ts");
const { db } = await import("../lib/db.ts"); const { events, apiTokens } = await import("@lifestack/db");

await db().delete(events); await db().delete(apiTokens);
const call = (auth: string | null, body: unknown, extra: Record<string, string> = {}) =>
  handleMcp(new Request("http://localhost/api/v1/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: auth } : {}), ...extra }, body: typeof body === "string" ? body : JSON.stringify(body) }), T);
const rpc = async (token: string, method: string, params?: unknown, id = 1) => { const r = await call(`Bearer ${token}`, { jsonrpc: "2.0", id, method, params }); assert.equal(r.status, 200, `${method} -> ${r.status}`); return (await r.json()) as any; };
const text = (r: any) => JSON.parse(r.result.content[0].text);

const agent = (await tok.createToken("agent", "agent", AGENT_SCOPES)).token;
const logOnly = (await tok.createToken("logger", "shortcut", ["log:write"])).token;
const calOnly = (await tok.createToken("cal", "agent", ["calendar:read"])).token;

// ---- auth
assert.equal((await call(null, {})).status, 401); assert.equal((await call("Bearer ls_" + "x".repeat(40), {})).status, 401); assert.equal((await call("Basic abc", {})).status, 401);
assert.equal((await call(`Bearer ${agent}`, {}, { origin: "https://evil.example" })).status, 403);
assert.equal((await call(`Bearer ${agent}`, "x".repeat(40_000))).status, 413);
await tok.revokeToken((await tok.listTokens()).find((t: any) => t.name === "cal")!.id);
assert.equal((await call(`Bearer ${calOnly}`, { jsonrpc: "2.0", id: 1, method: "tools/list" })).status, 401, "revoked key is refused");
const calOnly2 = (await tok.createToken("cal2", "agent", ["calendar:read"])).token;

// ---- protocol and scope filtering
const init = await rpc(agent, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } });
assert.equal(init.result.serverInfo.name, "life-stack");
const names = async (t: string) => ((await rpc(t, "tools/list")).result.tools as { name: string }[]).map((x) => x.name).sort();
assert.deepEqual(await names(agent), ["get_calendar", "get_finance_summary", "get_holdings", "get_overview", "get_profile", "get_sleep", "get_today", "get_transactions", "get_week_summary", "log_event"]);
assert.deepEqual(await names(logOnly), ["log_event"]); assert.deepEqual(await names(calOnly2), ["get_calendar", "get_overview", "get_week_summary"]);
const denied = await rpc(calOnly2, "tools/call", { name: "get_finance_summary", arguments: {} });
assert.ok(denied.error || denied.result?.isError, "a calendar-only key cannot call finance tools");
assert.ok(!JSON.stringify(denied).includes("netWorth"));

// ---- log_event and get_today
const logged = text(await rpc(agent, "tools/call", { name: "log_event", arguments: { type: "mood", value: 4, note: "calm", id: "mcp-test-1" } }));
assert.equal(logged.created, true);
assert.equal(text(await rpc(agent, "tools/call", { name: "log_event", arguments: { type: "mood", value: 4, id: "mcp-test-1" } })).created, false, "same id never logs twice");
const bad = await rpc(agent, "tools/call", { name: "log_event", arguments: { type: "mood", value: 9 } }); assert.equal(bad.result.isError, true);
await rpc(agent, "tools/call", { name: "log_event", arguments: { type: "caffeine", drink: "Coffee" } });
const today = text(await rpc(agent, "tools/call", { name: "get_today", arguments: {} }));
assert.equal(today.mood.value, 4); assert.equal(today.caffeine.mg, 95);
const overview = text(await rpc(agent, "tools/call", { name: "get_overview", arguments: {} }));
assert.equal(overview.log.mood.value, 4); assert.ok(overview.calendar); assert.ok("lastNight" in overview.sleep);
const week = text(await rpc(agent, "tools/call", { name: "get_week_summary", arguments: {} }));
assert.equal(week.mood.avg, 4); assert.equal(week.caffeineMg, 95);
assert.equal((await db().select().from(events)).filter((e) => e.source === "agent").length, 2, "logged by the agent kind");

// ---- calendar
const now = new Date(); const soon = new Date(now.getTime() + 2 * 86400_000);
await db().insert(events).values({ ts: soon, domain: "calendar", key: "calendar.event", source: "outlook", sourceId: "c1", payload: { title: "Dentist", end: new Date(soon.getTime() + 3600_000).toISOString(), allDay: false, location: "Main St" } } as any);
const cal = text(await rpc(calOnly2, "tools/call", { name: "get_calendar", arguments: {} }));
assert.deepEqual(cal.map((c: any) => c.title), ["Dentist"]);
const calOv = text(await rpc(calOnly2, "tools/call", { name: "get_overview", arguments: {} }));
assert.equal(calOv.log, undefined, "a calendar-only key never receives the log");
assert.ok(Array.isArray(calOv.calendar.upcoming) || Array.isArray(calOv.calendar.today));
assert.equal((await rpc(calOnly2, "tools/call", { name: "get_calendar", arguments: { from: "2026-01-01", to: "2026-12-31" } })).result.isError, true, "range is capped");
assert.equal((await rpc(calOnly2, "tools/call", { name: "get_calendar", arguments: { from: "nope" } })).result?.isError ?? true, true);

// ---- sleep and finance on an empty database still answer cleanly
assert.deepEqual(text(await rpc(agent, "tools/call", { name: "get_sleep", arguments: {} })), []);
assert.equal(text(await rpc(agent, "tools/call", { name: "get_finance_summary", arguments: {} })).netWorth.net, 0);
assert.deepEqual(text(await rpc(agent, "tools/call", { name: "get_transactions", arguments: { limit: 5 } })), []);
assert.deepEqual(text(await rpc(agent, "tools/call", { name: "get_holdings", arguments: {} })), []);
assert.equal((await rpc(agent, "tools/call", { name: "get_transactions", arguments: { limit: 1000 } })).result?.isError ?? true, true, "limit is capped");

const who = text(await rpc(agent, "tools/call", { name: "get_profile", arguments: {} }));
assert.equal(who.timezone, "UTC");
assert.equal(who.name, undefined);

await db().delete(events); await db().delete(apiTokens);
console.log("MCP OK"); process.exit(0);
