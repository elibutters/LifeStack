// The iPhone app's API: password login, throttling, key replacement, scopes and each read endpoint.
// Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
process.env.APP_PASSWORD = "correct horse battery staple"; process.env.SESSION_SECRET = "s".repeat(40); process.env.APP_TZ = "UTC";
const login = await import("../lib/app-login.ts"); const api = await import("../lib/app-api.ts"); const tok = await import("../lib/tokens.ts");
const { db } = await import("../lib/db.ts"); const { events, apiTokens, authAttempts, users } = await import("@lifestack/db"); const usr = await import("../lib/users.ts"); const pw = await import("../lib/passwords.ts"); const sess = await import("../lib/session.ts");

await db().delete(events); await db().delete(apiTokens); await db().delete(users); await db().delete(authAttempts);
delete process.env.OWNER_EMAIL;
const post = (body: unknown, h: Record<string, string> = {}) => login.handleLogin(new Request("http://x/api/v1/auth/login", { method: "POST", headers: { "x-real-ip": "10.0.0.1", ...h }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const PW = process.env.APP_PASSWORD!;

// ---- login
assert.equal((await post({ password: PW }, { origin: "https://evil.example" })).status, 403);
assert.equal((await post("not json")).status, 400); assert.equal((await post({ nope: 1 })).status, 400); assert.equal((await post({ password: "x".repeat(2000) })).status, 413);
const wrong = await post({ password: "wrong" }); assert.equal(wrong.status, 401); assert.ok(!JSON.stringify(await wrong.json()).includes("ls_"));
const ok = await post({ password: PW, device: "Test phone" }); assert.equal(ok.status, 200);
const { token } = (await ok.json()) as { token: string }; assert.match(token, /^ls_[A-Za-z0-9_-]{40,}$/);
const row = (await tok.listTokens()).find((t: any) => t.name === "Test phone")!; assert.equal(row.kind, "app"); assert.ok(row.scopes.includes("account:read") && row.scopes.includes("finance:read"));
// signing in again on the same device replaces its key
const again = (await (await post({ password: PW, device: "Test phone" })).json()) as { token: string };
assert.notEqual(again.token, token); assert.equal((await tok.verifyBearer(`Bearer ${token}`)).ok, false, "the old key stops working"); assert.equal((await tok.verifyBearer(`Bearer ${again.token}`)).ok, true);
assert.equal((await tok.listTokens()).filter((t: any) => t.name === "Test phone" && !t.revokedAt).length, 1);
// throttling: the sixth wrong attempt from one address is refused, even with the right password after
await db().delete(authAttempts);
for (let i = 0; i < 5; i++) assert.equal((await post({ password: "nope" })).status, 401);
assert.equal((await post({ password: "nope" })).status, 429); assert.equal((await post({ password: PW })).status, 429, "throttled even for the right password");
assert.equal((await post({ password: PW }, { "x-real-ip": "10.0.0.2" })).status, 200, "another address is not affected");
await db().delete(authAttempts);

// ---- endpoints
const get = (h: (r: Request) => Promise<Response>, path: string, t: string | null) => h(new Request("http://x" + path, { headers: t ? { authorization: `Bearer ${t}` } : {} }));
const app = again.token;
const logOnly = (await tok.createToken("logger", "shortcut", ["log:read"])).token; const calOnly = (await tok.createToken("cal", "agent", ["calendar:read"])).token;
for (const [h, p] of [[api.handleOverview, "/api/v1/overview"], [api.handleCalendar, "/api/v1/calendar"], [api.handleSleep, "/api/v1/sleep"], [api.handleFinance, "/api/v1/finance"], [api.handleTransactions, "/api/v1/finance/transactions"], [api.handleHoldings, "/api/v1/finance/holdings"], [api.handleConnections, "/api/v1/connections"]] as const) {
  assert.equal((await get(h, p, null)).status, 401, `${p} needs a key`);
  assert.equal((await get(h, p, app)).status, 200, `${p} works for the app key`);
}
assert.equal((await get(api.handleCalendar, "/api/v1/calendar", logOnly)).status, 403); assert.equal((await get(api.handleFinance, "/api/v1/finance", calOnly)).status, 403); assert.equal((await get(api.handleConnections, "/api/v1/connections", calOnly)).status, 403);

const ov = await (await get(api.handleOverview, "/api/v1/overview", app)).json() as any;
assert.deepEqual(Object.keys(ov).sort(), ["calendar", "date", "finance", "log", "sleep"]); assert.ok(ov.calendar && ov.sleep && ov.finance && ov.log);
const ovLog = await (await get(api.handleOverview, "/api/v1/overview", logOnly)).json() as any;
assert.equal(ovLog.calendar, null); assert.equal(ovLog.sleep, null); assert.equal(ovLog.finance, null); assert.ok(ovLog.log, "a log-only key sees only its own section");

const soon = new Date(Date.now() + 2 * 86400_000);
await db().insert(events).values({ ts: soon, domain: "calendar", key: "calendar.event", source: "outlook", sourceId: "c1", payload: { title: "Dentist", end: new Date(soon.getTime() + 3600_000).toISOString(), allDay: false } } as any);
const cal = await (await get(api.handleCalendar, "/api/v1/calendar", app)).json() as any; assert.deepEqual(cal.items.map((i: any) => i.title), ["Dentist"]);
for (const bad of ["?from=nope", "?from=2026-01-01&to=2026-12-31", "?from=2026-05-02&to=2026-05-01"]) assert.equal((await get(api.handleCalendar, "/api/v1/calendar" + bad, app)).status, 400, bad);
assert.equal((await get(api.handleSleep, "/api/v1/sleep?nights=999", app)).status, 400); assert.equal((await get(api.handleTransactions, "/api/v1/finance/transactions?limit=0", app)).status, 400);
assert.deepEqual((await (await get(api.handleHoldings, "/api/v1/finance/holdings", app)).json() as any).holdings, []);
const conns = await (await get(api.handleConnections, "/api/v1/connections", app)).json() as any; assert.deepEqual(Object.keys(conns).sort(), ["banks", "calendar", "sleep"]);

// ---- accounts: email and password
await db().delete(apiTokens); await db().delete(authAttempts);
const legacy = (await tok.createToken("old key", "shortcut", ["log:read"])).token; // made before accounts existed
process.env.OWNER_EMAIL = "Owner@Example.com";
assert.equal((await post({ password: PW })).status, 401, "once an owner email is set, a password alone is not enough");
assert.equal((await post({ email: "other@example.com", password: PW })).status, 401, "the wrong email cannot create the owner");
assert.equal((await post({ email: "owner@example.com", password: "nope" })).status, 401);
const first = await post({ email: "owner@example.com", password: PW, device: "Phone" }); assert.equal(first.status, 200);
const owner = (await db().select().from(users))[0]!; assert.equal(owner.email, "owner@example.com"); assert.notEqual(owner.passwordHash, PW); assert.ok(owner.passwordHash.startsWith("scrypt$") && !owner.passwordHash.includes(PW));
assert.equal(await usr.userCount(), 1);
const ownerKey = (await first.json() as { token: string }).token;
const rows = await tok.listTokens(); assert.equal((rows.find((t: any) => t.name === "Phone") as any).userId ?? owner.id, owner.id);
assert.equal((await db().select().from(apiTokens)).every((t) => t.userId === owner.id), true, "earlier keys are handed to the owner");
assert.equal((await tok.verifyBearer(`Bearer ${legacy}`)).ok, true, "and keep working");
// from now on the stored hash decides, and the email is case-insensitive
await db().delete(authAttempts);
assert.equal((await post({ email: "OWNER@example.COM", password: PW })).status, 200);
assert.equal((await post({ email: "owner@example.com", password: PW + "x" })).status, 401); assert.equal((await post({ email: "nobody@example.com", password: PW })).status, 401);
await db().delete(authAttempts);
assert.equal((await post({ email: "not an email", password: PW })).status, 401); assert.equal((await post({ password: PW })).status, 401);
assert.equal(await pw.verifyPassword("right", await pw.hashPassword("right")), true); assert.equal(await pw.verifyPassword("wrong", await pw.hashPassword("right")), false);
assert.notEqual(await pw.hashPassword("same"), await pw.hashPassword("same"), "a fresh salt each time");
// a second person has their own password and their own keys
await db().delete(authAttempts);
const second = await usr.createUser("second@example.com", "a different long password");
assert.equal((await post({ email: "second@example.com", password: PW })).status, 401, "the owner's password does not open their account");
const sk = await post({ email: "second@example.com", password: "a different long password", device: "Phone" }); assert.equal(sk.status, 200);
const secondKey = (await sk.json() as { token: string }).token;
const v = await tok.verifyBearer(`Bearer ${secondKey}`); assert.ok(v.ok && v.token.userId === second.id);
const again2 = (await (await post({ email: "owner@example.com", password: PW, device: "Phone" })).json()) as { token: string };
assert.equal((await tok.verifyBearer(`Bearer ${secondKey}`)).ok, true, "signing in as the owner does not replace the second user's key");
assert.equal((await tok.verifyBearer(`Bearer ${ownerKey}`)).ok, false); assert.equal((await tok.verifyBearer(`Bearer ${again2.token}`)).ok, true);
// sessions name their user
const sk2 = process.env.SESSION_SECRET + "\0" + process.env.APP_PASSWORD; const c = await sess.createSession(sk2, 7);
assert.equal(await sess.sessionUserId(c, sk2), 7); assert.equal(await sess.sessionUserId(c.replace(/^7/, "8"), sk2), null, "the user id cannot be edited"); assert.equal(await sess.sessionUserId(c.split(".").slice(1).join("."), sk2), null, "the old two-part format is refused");
delete process.env.OWNER_EMAIL;

await db().delete(events); await db().delete(apiTokens); await db().delete(users); await db().delete(authAttempts);
console.log("APP API OK"); process.exit(0);
