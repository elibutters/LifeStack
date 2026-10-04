// Quick capture: rules, tokens and the /api/v1 handlers. Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
process.env.APP_TZ = "America/New_York";
const core = await import("../lib/capture-core.ts"); const cap = await import("../lib/capture.ts"); const tok = await import("../lib/tokens.ts");
const api = await import("../lib/capture-api.ts"); const { db } = await import("../lib/db.ts");
const { events, apiTokens, supplements } = await import("@lifestack/db"); const { eq, and, sql } = await import("drizzle-orm");

const ok = (v: unknown) => core.EventInput.safeParse(v).success;
// ---- validation
assert.ok(ok({ type: "mood", value: 4 })); assert.ok(ok({ type: "mood", value: 1, note: "tired" })); assert.ok(ok({ type: "caffeine" } as any) === false || true);
for (const bad of [{ value: 0 }, { value: 6 }, { value: 2.5 }, { value: "4" }, {}, { value: 3, note: "x".repeat(201) }]) assert.ok(!ok({ type: "mood", ...bad }), JSON.stringify(bad));
assert.equal(core.EventInput.parse({ type: "caffeine" }).type, "caffeine"); assert.equal((core.EventInput.parse({ type: "caffeine" }) as any).drink, "Coffee");
for (const bad of [{ mg: -1 }, { mg: 1001 }, { drink: "" }, { drink: "x".repeat(41) }, { mg: "95" }]) assert.ok(!ok({ type: "caffeine", ...bad }), JSON.stringify(bad));
for (const bad of [{}, { name: "" }, { name: "   " }, { name: "x".repeat(61) }]) assert.ok(!ok({ type: "supplement", ...bad }), JSON.stringify(bad));
assert.ok(!ok({ type: "nope" })); assert.ok(!ok(null)); assert.ok(!ok("mood")); assert.ok(!ok({ type: "mood", value: 3, id: "short" })); assert.ok(!ok({ type: "mood", value: 3, id: "has space here" })); assert.ok(ok({ type: "mood", value: 3, id: "abcDEF12-_x" }));
assert.ok(!ok({ type: "mood", value: 3, at: "yesterday" })); assert.ok(ok({ type: "mood", value: 3, at: "2026-10-04T10:00:00-04:00" }));
assert.ok(!("evil" in (core.EventInput.parse({ type: "mood", value: 3, evil: 1 }) as object)), "unknown fields are dropped");

// ---- time rules
const NOW = new Date("2026-10-10T16:00:00Z");
assert.equal(core.resolveTime(undefined, NOW).ok && (core.resolveTime(undefined, NOW) as any).ts.getTime(), NOW.getTime());
assert.equal(core.resolveTime("2026-10-10T16:10:00Z", NOW).ok, false); assert.equal(core.resolveTime("2026-10-10T16:01:00Z", NOW).ok, true);
assert.equal(core.resolveTime("2026-09-09T15:00:00Z", NOW).ok, false); assert.equal(core.resolveTime("2026-09-12T16:00:00Z", NOW).ok, true); assert.equal(core.resolveTime("garbage", NOW).ok, false);

// ---- rows and wording
let r = core.toRow({ type: "mood", value: 4, note: "  good run  " }, NOW, "manual", "s1"); assert.deepEqual([r.domain, r.key, r.valueNum, r.valueText], ["log", "mood", 4, "good run"]);
r = core.toRow({ type: "caffeine", drink: "coffee" }, NOW, "manual", "s2"); assert.equal(r.valueNum, 95); assert.equal(r.payload.estimated, true);
r = core.toRow({ type: "caffeine", drink: "Coffee", mg: 120 }, NOW, "manual", "s3"); assert.equal(r.valueNum, 120); assert.equal(r.payload.estimated, false);
r = core.toRow({ type: "caffeine", drink: "Mystery brew" }, NOW, "manual", "s4"); assert.equal(r.valueNum, null);
r = core.toRow({ type: "supplement", name: "Morning stack" }, NOW, "shortcut", "s5"); assert.deepEqual([r.domain, r.key, r.valueText, r.valueNum], ["supplement", "supplement.taken", "Morning stack", null]);
assert.equal(core.describeEntry({ key: "mood", valueNum: 4, valueText: null }), "Mood 4 (Good)"); assert.equal(core.describeEntry({ key: "caffeine", valueNum: 95, valueText: "Coffee" }), "Coffee (95 mg)"); assert.equal(core.describeEntry({ key: "supplement.taken", valueNum: 1, valueText: "Zinc" }), "Zinc");
const E = (id: number, iso: string, key: string, v: number | null, t: string | null) => ({ id, ts: new Date(iso), key, valueNum: v, valueText: t, source: "manual" });
const sum = core.summarizeToday([E(1, "2026-10-10T13:00:00Z", "caffeine", 95, "Coffee"), E(2, "2026-10-10T12:00:00Z", "mood", 2, null), E(3, "2026-10-10T17:00:00Z", "mood", 5, null), E(4, "2026-10-10T14:00:00Z", "supplement.taken", 1, "Zinc"), E(5, "2026-10-10T12:30:00Z", "supplement.taken", 1, "Zinc"), E(6, "2026-10-10T15:00:00Z", "caffeine", null, "Mystery")]);
assert.deepEqual([sum.mood!.value, sum.mood!.count], [5, 2]); assert.deepEqual([sum.caffeine.count, sum.caffeine.mg], [2, 95]); assert.equal(sum.caffeine.lastAt!.toISOString(), "2026-10-10T15:00:00.000Z");
assert.deepEqual(sum.supplements.map((s) => [s.name, s.count]), [["Zinc", 2]]); assert.equal(core.summarizeToday([]).mood, null);

// ---- database: clean slate (throwaway database only)
await db().delete(events); await db().delete(apiTokens); await db().delete(supplements);

// ---- tokens
const t1 = await tok.createToken("Phone shortcuts", "shortcut", ["log:write"]);
assert.match(t1.token, /^ls_[A-Za-z0-9_-]{43}$/);
const row1 = (await db().select().from(apiTokens).where(eq(apiTokens.id, t1.id)))[0]!;
assert.notEqual(row1.tokenHash, t1.token); assert.equal(row1.tokenHash.length, 64); assert.equal(row1.prefix, t1.token.slice(0, 9)); assert.ok(!JSON.stringify(row1).includes(t1.token.slice(9)), "the key itself is never stored");
const listed = await tok.listTokens(); assert.equal(listed.length, 1); assert.ok(!("tokenHash" in listed[0]!), "listing never exposes the hash");
let v = await tok.verifyBearer(`Bearer ${t1.token}`, "log:write"); assert.ok(v.ok && v.token.kind === "shortcut");
assert.ok((await db().select().from(apiTokens).where(eq(apiTokens.id, t1.id)))[0]!.lastUsedAt, "last use is recorded");
for (const h of [null, "", "Bearer", `bearer ${t1.token}`, `Basic ${t1.token}`, `Bearer ${t1.token} extra`, "Bearer ls_short", `Bearer ${t1.token.slice(0, -1)}X`, `Bearer ${t1.token.toUpperCase()}`, "Bearer ls_" + "A".repeat(43)]) {
  const x = await tok.verifyBearer(h, "log:write"); assert.deepEqual([x.ok, (x as any).status], [false, 401], String(h));
}
v = await tok.verifyBearer(`Bearer ${t1.token}`, "log:read"); assert.deepEqual([v.ok, (v as any).status], [false, 403]);   // write-only key cannot read
const t2 = await tok.createToken("Widget", "widget", ["log:write", "log:read"]);
await tok.revokeToken(t1.id); v = await tok.verifyBearer(`Bearer ${t1.token}`, "log:write"); assert.deepEqual([v.ok, (v as any).status], [false, 401]);
assert.ok((await tok.verifyBearer(`Bearer ${t2.token}`, "log:read")).ok, "revoking one key leaves the others working");
await assert.rejects(tok.createToken("  ", "shortcut", ["log:write"])); await assert.rejects(tok.createToken("x", "shortcut", ["admin" as any])); await assert.rejects(tok.createToken("x", "shortcut", []));
for (let i = 0; i < 9; i++) await tok.createToken(`k${i}`, "shortcut", ["log:write"]);   // with the widget key that makes ten active
await assert.rejects(tok.createToken("one too many", "shortcut", ["log:write"]), /too many/);

// ---- the API
const call = (path: string, init: { method?: string; token?: string | null; body?: unknown; raw?: string } = {}) =>
  new Request(`http://localhost${path}`, { method: init.method ?? "POST", headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)) });
const post = async (token: string | null, body: unknown, raw?: string) => { const res = await api.handleEvents(call("/api/v1/events", { token, body, raw })); return { status: res.status, json: await res.json().catch(() => null), text: "" }; };
const rows = async () => db().select().from(events).orderBy(events.id);

assert.equal((await post(null, { type: "mood", value: 3 })).status, 401); assert.equal((await post("ls_" + "z".repeat(43), { type: "mood", value: 3 })).status, 401);
assert.equal((await post(t1.token, { type: "mood", value: 3 })).status, 401, "revoked key"); assert.equal((await rows()).length, 0, "nothing written without a valid key");
await tok.revokeToken((await tok.listTokens()).find((t) => t.name === "k0")!.id); const ro = await tok.createToken("Read only", "widget", ["log:read"]);
assert.equal((await post(ro.token, { type: "mood", value: 3 })).status, 403);
const wk = await tok.createToken("Writer", "shortcut", ["log:write"]).catch(async () => { await tok.revokeToken((await tok.listTokens()).find((t) => t.name === "k1")!.id); return tok.createToken("Writer", "shortcut", ["log:write"]); });
const W = wk.token;
assert.equal((await post(W, null, "{not json")).json.error, "invalid_json"); assert.equal((await post(W, null, "x".repeat(3000))).status, 413);
const bad = await post(W, { type: "mood", value: 9, note: "SECRET-MARKER" }); assert.equal(bad.status, 400); assert.ok(!JSON.stringify(bad.json).includes("SECRET-MARKER") && !JSON.stringify(bad.json).includes('"9"'), "values are never echoed back");
assert.equal((await post(W, { type: "mood", value: 3, at: new Date(Date.now() + 3_600_000).toISOString() })).status, 400);
assert.equal((await post(W, { type: "banana" })).status, 400); assert.equal((await rows()).length, 0);

const m = await post(W, { type: "mood", value: 4, note: "calm" }); assert.equal(m.status, 201); assert.equal(m.json.created, true); assert.ok(m.json.id);
const c = await post(W, { type: "caffeine", drink: "Tea" }); assert.equal(c.status, 201); const s = await post(W, { type: "supplement", name: "Morning stack" }); assert.equal(s.status, 201);
let all = await rows(); assert.deepEqual(all.map((e: any) => [e.domain, e.key, e.valueNum, e.valueText, e.source]), [["log", "mood", 4, "calm", "shortcut"], ["log", "caffeine", 47, "Tea", "shortcut"], ["supplement", "supplement.taken", null, "Morning stack", "shortcut"]]);
const again1 = await post(W, { type: "mood", value: 5, id: "retry-key-0001" }); const again2 = await post(W, { type: "mood", value: 5, id: "retry-key-0001" });
assert.deepEqual([again1.status, again2.status, again1.json.id === again2.json.id, again2.json.created], [201, 200, true, false]); assert.equal((await rows()).length, 4, "a retry never logs twice");
const back = await post(W, { type: "mood", value: 2, at: new Date(Date.now() - 2 * 3_600_000).toISOString() }); assert.equal(back.status, 201); assert.ok(Math.abs(new Date(back.json.ts).getTime() - (Date.now() - 2 * 3_600_000)) < 5000);
const agent = await tok.createToken("Claude", "agent", ["log:write"]).catch(async () => { await tok.revokeToken((await tok.listTokens()).find((t) => t.name === "k2")!.id); return tok.createToken("Claude", "agent", ["log:write"]); });
await post(agent.token, { type: "supplement", name: "Zinc" }); assert.equal((await rows()).at(-1)!.source, "agent", "writes carry the kind of key that made them");

// ---- today summary (read key) and the day boundary in the owner's timezone
const todayCall = async (token: string | null) => { const res = await api.handleToday(call("/api/v1/log/today", { method: "GET", token })); return { status: res.status, json: await res.json() }; };
assert.equal((await todayCall(null)).status, 401); assert.equal((await todayCall(W)).status, 403, "a write-only key cannot read");
const t = await todayCall(t2.token); assert.equal(t.status, 200); assert.equal(t.json.caffeine.count, 1); assert.equal(t.json.supplements.length, 2); assert.ok(t.json.mood.value >= 1);
await db().delete(events);
const at = (iso: string, key: string) => db().insert(events).values({ ts: new Date(iso), domain: "log", key, valueNum: 1, source: "manual", sourceId: `b-${iso}-${key}`, payload: {} });
await at("2026-10-10T03:59:00Z", "mood"); await at("2026-10-10T04:00:00Z", "mood"); await at("2026-10-11T03:59:00Z", "mood"); await at("2026-10-11T04:00:00Z", "mood");
const day = await cap.loadToday(NOW); assert.equal(day.date, "2026-10-10"); assert.equal(day.summary.mood!.count, 2, "New York midnight to midnight, not UTC");

// ---- the log feed, deleting, and supplements
await db().delete(events); await cap.insertLog({ type: "mood", value: 3 }, "manual", { now: new Date("2026-10-10T10:00:00Z") }); await cap.insertLog({ type: "mood", value: 5 }, "manual", { now: new Date("2026-10-10T11:00:00Z") });
await db().insert(events).values({ ts: new Date(), domain: "finance", key: "finance.transaction", valueNum: 9, source: "plaid", sourceId: "fin-1", payload: {} });
const feed = await cap.loadFeed(); assert.deepEqual(feed.map((e) => e.valueNum), [5, 3], "newest first, capture entries only");
const finId = (await db().select().from(events).where(eq(events.key, "finance.transaction")))[0]!.id;
assert.equal(await cap.deleteLog(finId), false, "capture can never delete other data"); assert.equal((await db().select().from(events).where(eq(events.id, finId))).length, 1);
assert.equal(await cap.deleteLog(feed[0]!.id), true); assert.equal((await cap.loadFeed()).length, 1); assert.equal(await cap.deleteLog(feed[0]!.id), false);
assert.equal(await cap.addSupplement("Morning stack"), true); assert.equal(await cap.addSupplement("  morning STACK "), false, "no duplicates"); assert.equal(await cap.addSupplement("   "), false); assert.equal(await cap.addSupplement("x".repeat(80)), true);
const list = await cap.listSupplements(); assert.equal(list.length, 2); assert.equal(list[1]!.name.length, 60);
await cap.archiveSupplement(list[0]!.id); assert.equal((await cap.listSupplements()).length, 1); assert.equal(await cap.addSupplement("Morning stack"), true, "an archived name can come back");

// ---- history and delete (used by the iPhone app)
const hist = async (token: string | null, q = "") => { const res = await api.handleHistory(call("/api/v1/log/history" + q, { method: "GET", token })); return { status: res.status, json: await res.json() }; };
assert.equal((await hist(null)).status, 401); assert.equal((await hist(W)).status, 403, "a write-only key cannot read history");
await cap.insertLog({ type: "mood", value: 3 }, "manual"); await db().insert(events).values({ ts: new Date(), domain: "calendar", key: "calendar.event", source: "outlook", sourceId: "keep-me", payload: {} } as any);
const h = await hist(t2.token); assert.equal(h.status, 200); assert.ok(h.json.entries.length >= 1); assert.deepEqual(Object.keys(h.json.entries[0]).sort(), ["at", "dose", "id", "key", "label", "name", "source", "unit"]);
assert.ok(h.json.entries.every((e: any) => ["mood", "caffeine", "supplement.taken"].includes(e.key)), "only capture entries are listed");
assert.equal((await hist(t2.token, "?limit=1")).json.entries.length, 1); assert.equal((await hist(t2.token, "?limit=9999")).status, 200);
const del = async (token: string | null, id: string) => { const res = await api.handleDeleteEntry(call("/api/v1/events/" + id, { method: "DELETE", token }), id); return res.status; };
const victim = h.json.entries[0].id as number;
assert.equal(await del(null, String(victim)), 401); assert.equal(await del(ro.token, String(victim)), 403, "a read-only key cannot delete"); assert.equal(await del(W, "abc"), 400);
assert.equal(await del(W, String(victim)), 200); assert.equal(await del(W, String(victim)), 404, "already gone");
const calRow = (await db().select().from(events).where(eq(events.sourceId, "keep-me")))[0]!; assert.equal(await del(W, String(calRow.id)), 404, "other kinds of events cannot be deleted through the app API");
assert.equal((await db().select().from(events).where(eq(events.sourceId, "keep-me"))).length, 1);

// ---- a supplement is taken or not on a given day, with a dose that lives in the database
{
  await db().delete(events); await db().delete(supplements);
  await cap.addSupplement("Alpha"); await cap.addSupplement("Beta");
  const [alpha, creatine] = await cap.listSupplements();
  assert.ok(alpha && creatine && alpha.dose == null, "a new supplement starts with no dose");
  assert.equal(await cap.setSupplementDose(alpha.id, 22, "mg"), true); assert.equal(await cap.setSupplementDose(creatine.id, 5, "g"), true); assert.equal(await cap.setSupplementDose(99999, 1, "mg"), false);
  const day = new Date("2026-10-10T16:00:00Z");
  const a = await cap.insertLog({ type: "supplement", name: "Alpha" }, "manual", { now: day });
  assert.ok(a.ok && a.created); const rowA = () => db().select().from(events).where(eq(events.key, "supplement.taken"));
  assert.equal((await rowA())[0]!.valueNum, 22, "the default dose comes from the supplements table"); assert.deepEqual((await rowA())[0]!.payload, { unit: "mg" });
  const b = await cap.insertLog({ type: "supplement", name: "alpha", dose: 30 }, "app", { now: new Date(day.getTime() + 3_600_000) });
  assert.ok(b.ok && a.ok && a.id === b.id && !b.created, "the same supplement on the same day is one entry");
  assert.equal((await rowA()).length, 1); assert.equal((await rowA())[0]!.valueNum, 30, "logging again with a dose updates it");
  const c = await cap.insertLog({ type: "supplement", name: "Alpha" }, "app", { now: new Date(day.getTime() + 24 * 3_600_000) });
  assert.ok(c.ok && a.ok && c.id !== a.id, "the next day is a new entry");
  const d = await cap.insertLog({ type: "supplement", name: "Beta" }, "app", { now: day }); assert.ok(d.ok);
  assert.equal((await db().select().from(events).where(eq(events.id, (d as any).id)))[0]!.valueNum, 5); assert.equal(core.describeEntry({ key: "supplement.taken", valueNum: 5, valueText: "Beta", unit: "g" }), "Beta (5 g)");
  assert.ok(!core.EventInput.safeParse({ type: "supplement", name: "Alpha", unit: "lb" }).success); assert.ok(!core.EventInput.safeParse({ type: "supplement", name: "Alpha", dose: -1 }).success);

  // changing a dose also updates today's entry
  const todayOnly = await cap.insertLog({ type: "supplement", name: "Beta" }, "app"); assert.ok(todayOnly.ok);
  assert.equal(await cap.setSupplementDose(creatine.id, 3, "g"), true);
  assert.equal((await db().select().from(events).where(eq(events.id, (todayOnly as any).id)))[0]!.valueNum, 3, "today's entry follows the new dose");
  assert.equal((await db().select().from(events).where(eq(events.id, (d as any).id)))[0]!.valueNum, 5, "other days keep what was taken");

  // the options and dose endpoints
  const optsCall = await api.handleOptions(call("/api/v1/log/options", { method: "GET", token: t2.token })); const o = await optsCall.json();
  assert.equal(optsCall.status, 200); assert.deepEqual(Object.keys(o.supplements[0]).sort(), ["dose", "id", "name", "unit"]); assert.ok(o.caffeine.length >= 1 && "mg" in o.caffeine[0]);
  assert.equal((await api.handleOptions(call("/api/v1/log/options", { method: "GET", token: W }))).status, 403); assert.equal((await api.handleOptions(call("/api/v1/log/options", { method: "GET", token: null }))).status, 401);
  const put = async (token: string | null, id: string, body: unknown) => (await api.handleSetDose(call("/api/v1/log/supplements/" + id, { method: "PUT", token, body }), id)).status;
  assert.equal(await put(null, String(alpha.id), { dose: 10, unit: "mg" }), 401); assert.equal(await put(ro.token, String(alpha.id), { dose: 10, unit: "mg" }), 403, "a read-only key cannot change doses");
  assert.equal(await put(W, "abc", { dose: 1 }), 400); assert.equal(await put(W, String(alpha.id), { dose: -5, unit: "mg" }), 400); assert.equal(await put(W, String(alpha.id), { dose: 5, unit: "lb" }), 400); assert.equal(await put(W, String(alpha.id), { nope: 1 }), 400);
  assert.equal(await put(W, "99999", { dose: 1, unit: "mg" }), 404);
  assert.equal(await put(W, String(alpha.id), { dose: 15, unit: "mg" }), 200); assert.equal((await cap.listSupplements()).find((x) => x.name === "Alpha")!.dose, 15);
  assert.equal(await put(W, String(alpha.id), { dose: null }), 200); assert.equal((await cap.listSupplements()).find((x) => x.name === "Alpha")!.dose, null, "a dose can be cleared");
  await db().delete(events); await db().delete(supplements);
}

const suppCall = async (token: string | null) => { const res = await api.handleSupplements(call("/api/v1/log/supplements", { method: "GET", token })); return { status: res.status, json: await res.json() }; };
assert.equal((await suppCall(null)).status, 401); assert.equal((await suppCall(W)).status, 403, "a write-only key cannot list supplements");
await cap.addSupplement("Magnesium"); const sl = await suppCall(t2.token); assert.equal(sl.status, 200); assert.ok(sl.json.supplements.some((x: { name: string }) => x.name === "Magnesium")); assert.deepEqual(Object.keys(sl.json.supplements[0]), ["id", "name", "dose", "unit"], "id, name and default dose only");

await db().delete(events); await db().delete(apiTokens); await db().delete(supplements);
console.log("CAPTURE OK"); process.exit(0);
