// Backups: encryption round trip, tamper detection, retention, and a full database restore.
// Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
const core = await import("../lib/backup-core.ts"); const bdb = await import("../lib/backup-db.ts"); const { db } = await import("../lib/db.ts");
const { events, supplements, apiTokens, connections, syncState, plaidItems, accounts } = await import("@lifestack/db"); const { sql } = await import("drizzle-orm");

const K = "ab".repeat(32); const K2 = "cd".repeat(32);
const tables = { events: [{ id: 1, note: "café", n: 2.5 }], empty: [] };
const buf = core.packBackup(tables, K, new Date("2026-10-04T09:00:00Z"));
assert.deepEqual(core.unpackBackup(buf, K).tables, tables); assert.equal(core.unpackBackup(buf, K).createdAt, "2026-10-04T09:00:00.000Z");
assert.ok(!buf.toString("latin1").includes("caf"), "contents are not readable");
assert.throws(() => core.unpackBackup(buf, K2)); assert.throws(() => core.unpackBackup(buf, "short"));
const bad = Buffer.from(buf); bad[bad.length - 1] ^= 1; assert.throws(() => core.unpackBackup(bad, K));
assert.throws(() => core.unpackBackup(Buffer.from("hello world, not a backup at all......."), K));
assert.notDeepEqual(core.packBackup(tables, K), core.packBackup(tables, K), "fresh iv each time");

// parents before children, ties in the given order, self-references and unknown tables ignored, a cycle falls back to the given order
assert.deepEqual(core.fkOrder(["accounts", "events", "plaid_items"], [{ child: "accounts", parent: "plaid_items" }]), ["events", "plaid_items", "accounts"]);
assert.deepEqual(core.fkOrder(["a", "b", "c"], [{ child: "a", parent: "b" }, { child: "b", parent: "c" }, { child: "c", parent: "c" }, { child: "a", parent: "zzz" }]), ["c", "b", "a"]);
assert.deepEqual(core.fkOrder(["a", "b"], [{ child: "a", parent: "b" }, { child: "b", parent: "a" }]), ["a", "b"]);

assert.equal(core.backupName(new Date("2026-10-04T09:00:00Z")), "backups/lifestack-2026-10-04.bin");
const names = ["a/x", ...[1, 2, 3, 4, 5].map((d) => `backups/lifestack-2026-10-0${d}.bin`)];
assert.deepEqual(core.expired(names, 3), ["backups/lifestack-2026-10-02.bin", "backups/lifestack-2026-10-01.bin"]); assert.deepEqual(core.expired(names, 10), []);

// ---- database round trip
await db().delete(events); await db().delete(supplements); await db().delete(apiTokens); await db().delete(connections); await db().delete(syncState);
const ts = new Date("2026-10-03T12:34:56.789Z");
await db().insert(events).values([{ ts, domain: "log", key: "mood", valueNum: 4, valueText: "calm", payload: { a: [1, { b: null }] }, source: "manual", sourceId: "t1" }, { ts, domain: "log", key: "caffeine", valueNum: 95, source: "manual", sourceId: "t2" }] as any);
await db().insert(supplements).values({ name: "Zinc" } as any);
// a table that points at another (accounts -> plaid_items) sorts before its parent alphabetically, so the restore must order by foreign key
await db().delete(accounts); await db().delete(plaidItems);
await db().insert(plaidItems).values({ id: "item-t", kind: "bank", env: "sandbox", institutionName: "Example Bank", accessTokenEnc: "x" } as any);
await db().insert(accounts).values({ name: "Checking", institution: "Example Bank", type: "depository", itemId: "item-t", plaidAccountId: "chk", currentBalance: 1 } as any);
// tables keyed by name instead of a generated id must restore too (connections, sync_state)
await db().insert(connections).values({ provider: "test", account: "a", refreshTokenEnc: "enc" } as any); await db().insert(syncState).values({ source: "test", cursor: "c" } as any);
const before = await bdb.dumpTables(db());
assert.ok(!("auth_attempts" in before) && !("__drizzle_migrations" in before)); assert.equal(before.events.length, 2);
const copy = core.unpackBackup(core.packBackup(before, K), K).tables;
await db().delete(events); await db().delete(supplements); await db().delete(connections); await db().delete(syncState); await db().delete(accounts); await db().delete(plaidItems);
await bdb.restoreTables(db(), copy);
assert.deepEqual(await bdb.dumpTables(db()), before, "restore reproduces every row exactly");
const [again] = await db().insert(events).values({ ts, domain: "log", key: "mood", valueNum: 3, source: "manual", sourceId: "t3" } as any).returning({ id: events.id });
assert.ok(again.id > Math.max(...(before.events as { id: number }[]).map((e) => e.id)), "id sequence continues after restore");
await db().delete(events); await db().delete(supplements); await db().delete(connections); await db().delete(syncState); await db().delete(accounts); await db().delete(plaidItems);
console.log("BACKUP OK"); process.exit(0);
