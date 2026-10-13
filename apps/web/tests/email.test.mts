// Email: classification and extraction rules, Outlook mail sync (Microsoft Graph mocked), search and the email:read API.
// Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
Object.assign(process.env, { MICROSOFT_CLIENT_ID: "cid", MICROSOFT_CLIENT_SECRET: "sec", ENCRYPTION_KEY: "ab".repeat(32), APP_URL: "https://app.example", APP_TZ: "UTC" });
const core = await import("../lib/email-core.ts");
const mail = await import("../lib/email.ts");
const tok = await import("../lib/tokens.ts");
const { encrypt } = await import("../lib/crypto.ts");
const { db } = await import("../lib/db.ts");
const { emails, connections, syncState, apiTokens } = await import("@lifestack/db");
const { eq } = await import("drizzle-orm");

// ---- rules
const at = new Date("2026-10-12T12:00:00Z");
const c = (subject: string, body = "", fromName = "Shop") => core.classify({ fromName, subject, body, receivedAt: at });
assert.equal(c("Your order has shipped").category, "shipping");
assert.equal(c("Order confirmation #123").category, "receipt");
assert.equal(c("Your statement is ready").category, "bill");
assert.equal(c("Appointment reminder: Dr visit").category, "appointment");
assert.equal(c("40% off everything this weekend").category, "deal");
assert.equal(c("Lunch tomorrow?").category, "other");
assert.equal(c("Hello", "Your package has shipped. Tracking 1Z999AA10123456784 arrives soon.").category, "shipping");
assert.deepEqual(c("Order confirmation", "Items...\nOrder total: $1,234.50\nThanks").extracted, { merchant: "Shop", amountCents: 123450 });
assert.equal(c("Receipt", "no total here, paid $9.99 today").extracted.amountCents, 999);
assert.deepEqual(c("Your order shipped", "Track: 1Z999AA10123456784. Arriving Oct 15.").extracted.tracking, { carrier: "UPS", number: "1Z999AA10123456784" });
assert.equal(c("Your order shipped", "Arriving Oct 15.").extracted.eventDate, "2026-10-15");
assert.equal(c("Your statement is ready", "Amount due: $82.10. Payment due November 3, 2026.").extracted.dueDate, "2026-11-03");
assert.equal(c("Your statement is ready", "Amount due: $82.10. Payment due November 3, 2026.").extracted.amountCents, 8210);
assert.equal(c("Appointment confirmed", "See you on 11/20/2026 at 3pm").extracted.eventDate, "2026-11-20");
assert.deepEqual(core.findDates("Jan 5 and Feb 30 and 13/45/2026", at), ["2027-01-05"], "no-year dates roll forward; impossible dates are ignored");
assert.equal(core.findDates("on Sept 3rd", at)[0], "2027-09-03");
assert.equal(core.findDates("on Oct 1", at)[0], "2026-10-01", "a date within a month back stays this year");
assert.equal(core.tidyBody("a  b\r\n\n\n\nc", "other"), "a b\n\nc");
assert.equal(core.tidyBody("x".repeat(9000), "other").length, 6000);
assert.equal(core.tidyBody("x".repeat(9000), "deal").length, 1200);
assert.deepEqual(
  core.agendaOf([
    { id: 1, category: "bill", subject: "Bill", fromName: "Power", extracted: { dueDate: "2026-10-20", amountCents: 5000 } },
    { id: 2, category: "appointment", subject: "Dentist", fromName: null, extracted: { eventDate: "2026-10-14" } },
    { id: 3, category: "shipping", subject: "Old", fromName: null, extracted: { eventDate: "2026-10-01" } },
    { id: 4, category: "receipt", subject: "R", fromName: null, extracted: { eventDate: "2026-10-30" } },
  ], "2026-10-12").map((i) => [i.id, i.kind, i.date]),
  [[2, "appointment", "2026-10-14"], [1, "bill", "2026-10-20"]],
);

// ---- Graph mock
let tokenStatus = 200; const calls: { url: string; prefer: string | null }[] = [];
const total = 120;
const msg = (i: number) => ({ id: `m${i}`, subject: i % 10 === 0 ? `Your order has shipped ${i}` : `Hello ${i}`, receivedDateTime: new Date(Date.UTC(2026, 9, 12) - i * 3_600_000).toISOString(), isRead: i % 2 === 0, hasAttachments: false, conversationId: "c1", from: { emailAddress: { name: "Sender", address: "s@example.com" } }, body: { content: `Body ${i}. Needle` } });
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url; const u = new URL(url);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  if (u.pathname.endsWith("/token")) return tokenStatus === 200 ? json({ access_token: "at", refresh_token: "rt2" }) : json({ error: "invalid_grant" }, 400);
  calls.push({ url, prefer: new Headers(init.headers ?? {}).get("prefer") });
  if (u.pathname.includes("/mailFolders/inbox/messages")) {
    const skip = Number(u.searchParams.get("skip") ?? 0);
    const rows = Array.from({ length: total }, (_, i) => msg(i)).slice(skip, skip + 50);
    const more = skip + 50 < total;
    return json({ value: rows, ...(more ? { "@odata.nextLink": `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?skip=${skip + 50}` } : {}) });
  }
  if (u.pathname.includes("/mailFolders/")) return json({ value: [] });
  return json({ error: "unexpected" }, 500);
}) as typeof fetch;

const reset = async () => { await db().delete(emails); await db().delete(connections); await db().delete(syncState); await db().delete(apiTokens); };
await reset();

// ---- sync
assert.equal(await mail.syncMail(), null, "nothing to sync before Outlook is linked");
await db().insert(connections).values({ provider: "outlook", account: "me@example.com", refreshTokenEnc: encrypt("rt1") });
let r = await mail.syncMail(); assert.deepEqual(r, { stored: total, done: true });
assert.equal((await db().select().from(emails)).length, total);
assert.ok(calls.every((x) => x.prefer?.includes('body-content-type="text"')), "mail is requested as plain text");
const shipped = (await db().select().from(emails).where(eq(emails.sourceId, "m10")))[0]!; assert.equal(shipped.category, "shipping"); assert.equal(shipped.isRead, true);
r = await mail.syncMail(); assert.ok(r && "stored" in r); assert.equal((await db().select().from(emails)).length, total, "a second run adds no duplicates");
assert.equal((await db().select().from(connections))[0]!.refreshTokenEnc.includes("rt2"), false, "the rotated token is stored encrypted");
tokenStatus = 400;
assert.equal(await mail.syncMail(), null); assert.match((await mail.mailStatus()).lastError ?? "", /Reconnect Outlook/);
tokenStatus = 200;

// ---- search
const all = await mail.searchEmails({}); assert.equal(all.length, 20); assert.ok(all[0]!.receivedAt >= all[1]!.receivedAt);
assert.equal((await mail.searchEmails({ category: "shipping", limit: 50 })).length, 12);
assert.equal((await mail.searchEmails({ q: "Hello 117" })).length, 1);
assert.equal((await mail.searchEmails({ q: "%" })).length, 0, "wildcards are matched literally");
assert.equal((await mail.searchEmails({ from: "S@EXAMPLE" , limit: 3 })).length, 3);
assert.equal((await mail.searchEmails({ since: "2026-10-11", limit: 50 })).length, 25, "hourly messages back to the start of that day");
assert.ok((await mail.searchEmails({}))[0]!.snippet.length > 0);
assert.equal((await mail.getEmail(all[0]!.id))!.body.includes("Needle"), true);
assert.equal(await mail.getEmail(999999), null);

// ---- API
const req = (path: string, key: string | null) => new Request(`http://localhost/api/v1/email${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
const withScope = await tok.createToken("a", "agent", ["email:read"]); const without = await tok.createToken("b", "agent", ["log:read"]);
assert.equal((await mail.handleEmailSearch(req("", null))).status, 401);
assert.equal((await mail.handleEmailSearch(req("", without.token))).status, 403);
const ok = await mail.handleEmailSearch(req("?category=shipping&limit=2", withScope.token)); assert.equal(ok.status, 200); assert.equal(((await ok.json()) as { emails: unknown[] }).emails.length, 2);
assert.equal((await mail.handleEmailSearch(req("?category=nope", withScope.token))).status, 400);
assert.equal((await mail.handleEmailSearch(req("?limit=500", withScope.token))).status, 400);
assert.equal((await mail.handleEmailOne(req("/1", withScope.token), "abc")).status, 404);
assert.equal((await mail.handleEmailOne(req("/1", without.token), String(all[0]!.id))).status, 403);
assert.equal((await mail.handleEmailOne(req("/1", withScope.token), String(all[0]!.id))).status, 200);
assert.equal((await mail.handleEmailAgenda(req("/agenda", withScope.token))).status, 200);
// ---- editing an existing key's permissions
const edit = await tok.createToken("c", "agent", ["log:read"]);
assert.equal((await mail.handleEmailSearch(req("", edit.token))).status, 403);
assert.equal(await tok.setTokenScopes(edit.id, ["log:read", "email:read"]), true);
assert.equal((await mail.handleEmailSearch(req("", edit.token))).status, 200, "a new permission works on the same key straight away");
assert.equal(await tok.setTokenScopes(edit.id, ["log:read"]), true);
assert.equal((await mail.handleEmailSearch(req("", edit.token))).status, 403, "and can be taken away again");
assert.equal(await tok.setTokenScopes(edit.id, []), false, "a key keeps at least one permission");
assert.equal(await tok.setTokenScopes(edit.id, ["nope" as never]), false);
assert.equal(await tok.setTokenScopes(999999, ["log:read"]), false);
const appKey = await tok.createAppToken("test phone", null);
assert.equal((await mail.handleEmailSearch(req("", appKey.token))).status, 403, "a phone key has no mail access by default");
assert.equal(await tok.setTokenScopes(appKey.id, [...(await import("../lib/capture-core.ts")).APP_SCOPES, "email:read"]), true, "the owner can allow it");
assert.equal((await mail.handleEmailSearch(req("", appKey.token))).status, 200, "and the key then reads mail");
assert.equal(await tok.setTokenScopes(appKey.id, ["log:read"]), true);
assert.equal((await tok.verifyBearer(`Bearer ${appKey.token}`, "log:write")).ok, false, "an edited phone key keeps exactly the chosen set");
assert.ok(!(await import("../lib/capture-core.ts")).APP_SCOPES.includes("email:read"), "the phone key never reads mail");

await reset();
console.log("email: ok");
process.exit(0);
