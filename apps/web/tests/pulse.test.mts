// The change counter behind /api/v1/pulse: what moves it and what does not. Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
Object.assign(process.env, { ENCRYPTION_KEY: "ab".repeat(32), APP_TZ: "America/New_York" });
const { db } = await import("../lib/db.ts");
const { events, todos, settings, apiTokens } = await import("@lifestack/db");
const { currentVersion, handlePulse } = await import("../lib/pulse.ts");
const tok = await import("../lib/tokens.ts");
const { eq } = await import("drizzle-orm");

const row = (o: Record<string, unknown> = {}) => ({ ts: new Date("2026-11-11T15:00:00Z"), domain: "calendar", key: "calendar.event", valueText: "a", payload: { title: "Run" }, source: "outlook", sourceId: "evt-1", ...o });
const moved = async (fn: () => Promise<unknown>) => { const a = await currentVersion(); await fn(); return (await currentVersion()) - a; };

await db().delete(events); await db().delete(todos); await db().delete(settings); await db().delete(apiTokens);

// ---- events: real changes move it
assert.ok((await moved(() => db().insert(events).values(row()))) >= 1, "a new event moves it");
assert.equal(await moved(() => db().insert(events).values(row({ domain: "mcp", key: "mcp.call", source: "mcp", sourceId: "u1" }))), 0, "MCP usage rows never do");

// ---- a sync re-saving identical content is not a change; a real change is
const upsert = (o: Record<string, unknown> = {}) => db().insert(events).values(row(o)).onConflictDoUpdate({ target: [events.source, events.sourceId], set: { ts: row(o).ts, domain: row(o).domain, key: row(o).key, valueText: row(o).valueText, payload: row(o).payload } });
assert.equal(await moved(() => upsert()), 0, "an upsert that rewrites the same content does not");
assert.ok((await moved(() => upsert({ payload: { title: "Run", place: "Park" } }))) >= 1, "an upsert that changes the payload does");
assert.ok((await moved(() => upsert({ ts: new Date("2026-11-11T16:00:00Z") }))) >= 1, "a moved time does");
assert.ok((await moved(() => upsert({ sourceId: "evt-2" }))) >= 1, "a new row through an upsert does");

// ---- plain updates and deletes
assert.equal(await moved(() => db().update(events).set({ valueText: "a" }).where(eq(events.sourceId, "evt-1"))), 0, "an update to the same value does not");
assert.ok((await moved(() => db().update(events).set({ valueText: "done" }).where(eq(events.sourceId, "evt-1")))) >= 1, "a changed value does");
assert.equal(await moved(() => db().delete(events).where(eq(events.sourceId, "u1"))), 0, "deleting bookkeeping does not");
assert.ok((await moved(() => db().delete(events).where(eq(events.sourceId, "evt-2")))) >= 1, "deleting an event does");
assert.equal(await moved(() => db().delete(events).where(eq(events.sourceId, "nothing"))), 0, "deleting nothing does not");

// ---- one statement is one tick, however many rows it writes
const many = Array.from({ length: 300 }, (_, i) => row({ sourceId: `bulk-${i}`, valueText: String(i) }));
assert.equal(await moved(() => db().insert(events).values(many)), 1, "a bulk write is a single tick");

// ---- the other tables the phone reads
assert.ok((await moved(() => db().insert(todos).values({ title: "x" } as any))) >= 1, "a to-do moves it");
assert.ok((await moved(() => db().insert(settings).values({ key: "k", value: { a: 1 } }))) >= 1, "a setting moves it");

// ---- the endpoint
const call = (auth?: string) => handlePulse(new Request("https://app.example/api/v1/pulse", { headers: auth ? { authorization: auth } : {} }));
assert.equal((await call()).status, 401, "no key, no answer");
assert.equal((await call("Bearer ls_nope_nope_nope_nope_nope")).status, 401, "a made-up key is refused");
const { token, id: tokenId } = await tok.createToken("pulse-test", "app", ["log:read"]);
const res = await call(`Bearer ${token}`);
assert.equal(res.status, 200); assert.equal(res.headers.get("cache-control"), "no-store");
const body = await res.json() as { version: number };
assert.equal(typeof body.version, "number"); assert.equal(body.version, await currentVersion(), "it reports the counter");
await db().insert(events).values(row({ sourceId: "after", valueText: "z" }));
assert.ok(((await (await call(`Bearer ${token}`)).json()) as { version: number }).version > body.version, "and it moves with the data");
await tok.revokeToken(tokenId);
assert.equal((await call(`Bearer ${token}`)).status, 401, "a revoked key is refused");

await db().delete(events); await db().delete(todos); await db().delete(settings); await db().delete(apiTokens);
console.log("pulse tests passed");
