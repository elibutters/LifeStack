// Settings: the registry and its validation, defaults vs custom values, the API and its scopes, and what changing mail rules does.
// Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
Object.assign(process.env, { APP_TZ: "UTC" });
const core = await import("../lib/settings-core.ts");
const ecore = await import("../lib/email-core.ts");
const store = await import("../lib/settings-store.ts");
const st = await import("../lib/settings.ts");
const tok = await import("../lib/tokens.ts");
const cap = await import("../lib/capture-core.ts");
const { db } = await import("../lib/db.ts");
const { settings, emails, apiTokens } = await import("@lifestack/db");
const { eq } = await import("drizzle-orm");

// ---- the registry
const ok = (k: string, v: unknown) => core.parseSetting(k, v).ok;
assert.equal(ok("nope", 1), false, "unknown settings are refused");
assert.match((core.parseSetting("nope", 1) as { error: string }).error, /Known settings: email\.rules/);
assert.equal(ok("map.style", "satellite"), true); assert.equal(ok("map.style", "neon"), false);
assert.equal(ok("map.lines", false), true); assert.equal(ok("map.lines", "no"), false);
assert.equal(ok("map.range", "30"), true); assert.equal(ok("map.range", 30), false);
assert.equal(ok("location.tripDistanceM", 50), true); assert.equal(ok("location.tripDistanceM", 5), false); assert.equal(ok("location.tripDistanceM", 500), false); assert.equal(ok("location.tripDistanceM", 12.5), false);
assert.equal(ok("location.tripStillMinutes", 10), true); assert.equal(ok("location.tripStillMinutes", 0), false);
assert.equal(ok("location.tripExitRadiusM", 100), true); assert.equal(ok("location.tripExitRadiusM", 99), false);
assert.equal(ok("email.rules", { bill: ["con edison"], other: ["newsletter"] }), true);
assert.equal(ok("email.rules", { bills: ["x"] }), false, "an unknown category is refused");
assert.equal(ok("email.rules", { bill: ["x"] }), false, "a phrase must be at least two characters");
assert.equal(ok("email.rules", { bill: Array.from({ length: 51 }, (_, i) => `phrase ${i}`) }), false);
assert.deepEqual((core.parseSetting("email.rules", { bill: ["  Con Edison  "] }) as { value: unknown }).value, { bill: ["Con Edison"] });
const none = core.resolveAll({}); assert.equal(none.length, core.SETTING_KEYS.length); assert.ok(none.every((s) => !s.custom && s.updatedAt === null && s.description.length > 20));
assert.equal(core.valueOf(none, "location.tripDistanceM"), 30);
const damaged = core.resolveAll({ "map.style": { value: "garbage", updatedAt: new Date() }, "map.lines": { value: false, updatedAt: new Date("2026-10-01T00:00:00Z") } });
assert.equal(core.valueOf(damaged, "map.style"), "dark", "a damaged stored value falls back to the default"); assert.equal(core.valueOf(damaged, "map.lines"), false);
assert.deepEqual(damaged.filter((s) => s.custom).map((s) => s.key), ["map.lines"]);

// ---- mail rules
const mail = (subject: string, fromName = "Someone", fromAddress = "a@example.com") => ({ subject, body: "", fromName, fromAddress, receivedAt: new Date("2026-10-12T12:00:00Z") });
assert.equal(ecore.classify(mail("Hello there")).category, "other");
assert.equal(ecore.classify(mail("Hello there", "Con Edison"), { bill: ["con edison"] }).category, "bill", "a sender name can be a rule");
assert.equal(ecore.classify(mail("Hello", "x", "billing@power.example"), { bill: ["power.example"] }).category, "bill", "and so can a sender address");
assert.equal(ecore.classify(mail("Your order has shipped"), { other: ["shipped"] }).category, "other", "other keeps a message out of every category");
assert.equal(ecore.classify(mail("Your order has shipped")).category, "shipping", "without rules the built-ins apply");
assert.equal(ecore.classify(mail("Weekly newsletter sale"), { deal: ["sale"], other: ["newsletter"] }).category, "other", "other wins over the others");
assert.equal(ecore.classify(mail("A statement"), { deal: ["statement"] }).category, "deal", "custom rules run ahead of the built-ins");

// ---- storage, defaults and the side effect on stored mail
const reset = async () => { await db().delete(settings); await db().delete(emails); await db().delete(apiTokens); };
await reset();
assert.deepEqual(await store.loadEmailRules(), {});
const bad = await st.changeSetting("map.style", "neon"); assert.equal(bad.ok, false); assert.equal((await db().select().from(settings)).length, 0, "a refused value is not stored");
const good = await st.changeSetting("map.style", "light"); assert.ok(good.ok && good.view.custom && good.view.value === "light");
assert.equal(core.valueOf(await st.listSettings(), "map.style"), "light");
const back = await st.resetSetting("map.style"); assert.ok(back.ok && !back.view.custom && back.view.value === "dark");
assert.equal((await st.resetSetting("nope")).ok, false);
const row = (n: number, subject: string, fromName: string, category = "other") => ({ sourceId: `m${n}`, folder: "inbox", receivedAt: new Date("2026-10-10T10:00:00Z"), subject, fromName, fromAddress: "x@example.com", bodyText: "", category, extracted: {} as Record<string, unknown> });
await db().insert(emails).values([row(1, "Your statement", "Con Edison"), row(2, "Lunch?", "Friend"), row(3, "Order update", "Shop", "other")]);
const rules = await st.changeSetting("email.rules", { bill: ["con edison"] });
assert.ok(rules.ok); const eff = (rules as { effects: { reclassified: { checked: number; changed: number } } }).effects.reclassified;
assert.equal(eff.checked, 3); assert.ok(eff.changed >= 1);
const cat = async (id: string) => (await db().select().from(emails).where(eq(emails.sourceId, id)))[0]!.category;
assert.equal(await cat("m1"), "bill", "existing mail is re-sorted with the new rules"); assert.equal(await cat("m2"), "other");
assert.deepEqual(await store.loadEmailRules(), { bill: ["con edison"] });
await st.resetSetting("email.rules"); assert.equal(await cat("m1"), "bill", "the built-in 'statement' rule still files it as a bill"); // 'Your statement' matches the built-in bill rule
await db().update(emails).set({ category: "bill" }).where(eq(emails.sourceId, "m2"));
await st.changeSetting("email.rules", { other: ["lunch"] }); assert.equal(await cat("m2"), "other");

// ---- the API and scopes
await reset();
const req = (method: string, key: string | null, body?: unknown, qs = "") => new Request(`http://localhost/api/v1/settings${qs}`, { method, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
const reader = await tok.createToken("r", "agent", ["settings:read"]); const writer = await tok.createToken("w", "agent", ["settings:write"]); const none2 = await tok.createToken("n", "agent", ["log:read"]);
assert.equal((await st.handleSettings(req("GET", null))).status, 401);
assert.equal((await st.handleSettings(req("GET", none2.token))).status, 403);
const list = await st.handleSettings(req("GET", reader.token)); assert.equal(list.status, 200); assert.equal(((await list.json()) as { settings: unknown[] }).settings.length, core.SETTING_KEYS.length);
assert.equal((await st.handleSettings(req("PUT", reader.token, { key: "map.lines", value: false }))).status, 403, "reading is not writing");
assert.equal((await st.handleSettings(req("GET", writer.token))).status, 403, "and writing is not reading");
const put = await st.handleSettings(req("PUT", writer.token, { key: "map.lines", value: false })); assert.equal(put.status, 200);
assert.equal(core.valueOf(await st.listSettings(), "map.lines"), false);
assert.equal((await st.handleSettings(req("PUT", writer.token, { key: "map.lines", value: "maybe" }))).status, 400);
assert.equal((await st.handleSettings(req("PUT", writer.token, { key: "unknown", value: 1 }))).status, 400);
assert.equal((await st.handleSettings(req("PUT", writer.token, "{not json"))).status, 400);
assert.equal((await st.handleSettings(req("PUT", writer.token, " ".repeat(20000)))).status, 413);
assert.equal((await st.handleSettings(req("DELETE", writer.token, undefined, "?key=map.lines"))).status, 200); assert.equal(core.valueOf(await st.listSettings(), "map.lines"), true);
assert.equal((await st.handleSettings(req("DELETE", writer.token, undefined, "?key=nope"))).status, 400);
assert.ok(cap.AGENT_SCOPES.includes("settings:read") && cap.AGENT_SCOPES.includes("settings:write"));
assert.ok(cap.APP_SCOPES.includes("settings:read") && !cap.APP_SCOPES.includes("settings:write"), "the phone can read preferences but not change them");

await reset();
console.log("settings: ok");
process.exit(0);
