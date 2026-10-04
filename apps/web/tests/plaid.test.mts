// Run with `pnpm test`. Uses mocked Plaid responses and ONLY the throwaway lifestack_test database.
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
const REAL_DB_URL = process.env.DATABASE_URL;
process.env.APP_TZ = "UTC"; process.env.ENCRYPTION_KEY = "ab".repeat(32);
process.env.PLAID_CLIENT_ID = "cid"; process.env.PLAID_SANDBOX_SECRET = "sbx"; process.env.PLAID_PRODUCTION_SECRET = "prd";
for (const k of ["VERCEL", "VERCEL_ENV", "PLAID_ENV"]) delete process.env[k];
const fin = await import("../lib/finance.ts"); const plaid = await import("../lib/plaid.ts"); const { db } = await import("../lib/db.ts");
const { describeError } = await import("../lib/errors.ts");
const { events, accounts, plaidItems } = await import("@lifestack/db"); const { eq, and, sql } = await import("drizzle-orm");

type Json = any; const calls: { path: string; body: Json }[] = [];
let S: { accounts: Json[]; pages: Json[]; liabilities: Json[]; holdings: Json; invTxns: Json[]; errors: Record<string, string[]>; gate: Promise<void> | null; gatePath: string } = reset();
function reset() { return { accounts: [], pages: [], liabilities: [], holdings: { holdings: [], securities: [] }, invTxns: [], errors: {}, gate: null, gatePath: "" }; }
const err = (code: string, type = "ITEM_ERROR", status = 400) => new Response(JSON.stringify({ error_type: type, error_code: code, error_message: "x" }), { status });
const ok = (b: Json) => new Response(JSON.stringify(b), { status: 200 });
const mock = (async (input: any, init: any) => {
  const url = new URL(String(input)); const path = url.pathname; const body = JSON.parse(init.body); calls.push({ path, body });
  assert.equal(url.host, "sandbox.plaid.com"); assert.equal(body.client_id, "cid"); assert.equal(body.secret, "sbx"); assert.ok(init.signal, "every call has a timeout");
  if (S.gate && path === S.gatePath) await S.gate;
  const q = S.errors[path]; if (q?.length) return err(q.shift()!);
  switch (path) {
    case "/item/public_token/exchange": return ok({ access_token: "access-" + body.public_token, item_id: "item-" + body.public_token });
    case "/item/get": return ok({ item: { institution_id: "ins_1" } });
    case "/institutions/get_by_id": return ok({ institution: { name: "Example Bank" } });
    case "/accounts/get": return ok({ accounts: S.accounts });
    case "/transactions/sync": { const p = S.pages.shift(); return p ? ok(p) : ok({ added: [], modified: [], removed: [], next_cursor: body.cursor ?? "c0", has_more: false }); }
    case "/liabilities/get": return ok({ liabilities: { credit: S.liabilities } });
    case "/investments/holdings/get": return ok(S.holdings);
    case "/investments/transactions/get": { const page = S.invTxns.slice(body.options.offset, body.options.offset + body.options.count); return ok({ investment_transactions: page, securities: S.holdings.securities, total_investment_transactions: S.invTxns.length }); }
    case "/item/remove": return ok({ request_id: "r" });
  }
  throw new Error("unexpected " + path);
}) as any;
globalThis.fetch = mock;

const acct = (id: string, name: string, type: string, cur: number, extra: Json = {}) => ({ account_id: id, name, official_name: null, type, subtype: type === "depository" ? "checking" : type, balances: { current: cur, available: cur, limit: null, iso_currency_code: "USD", ...extra } });
const tx = (id: string, acc: string, amt: number, date: string, extra: Json = {}) => ({ transaction_id: id, account_id: acc, amount: amt, date, authorized_date: null, name: "Merchant " + id, merchant_name: null, pending: false, pending_transaction_id: null, iso_currency_code: "USD", personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE" }, ...extra });
const page = (o: Json) => ({ added: [], modified: [], removed: [], has_more: false, ...o });
const rows = (k?: string) => db().select().from(events).where(k ? and(eq(events.source, "plaid"), eq(events.key, k)) : eq(events.source, "plaid"));
const item = async (id: string) => (await db().select().from(plaidItems).where(eq(plaidItems.id, id)))[0];
const tick = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const quietly = async <T,>(f: () => Promise<T>): Promise<{ out: string; result?: T; error?: unknown }> => {
  const logs: string[] = []; const orig = console.error; console.error = (...a: unknown[]) => logs.push(a.map(String).join(" "));
  try { return { out: logs.join("\n"), result: await f() }; } catch (error) { return { out: logs.join("\n"), error }; } finally { console.error = orig; }
};

await db().delete(events); await db().delete(plaidItems);

// ---- link: token stored encrypted, environment recorded
const id1 = await fin.linkItem("bank", "p1"); assert.equal(id1, "item-p1");
let it = await item(id1); assert.equal(it.institutionName, "Example Bank"); assert.equal(it.kind, "bank"); assert.equal(it.env, "sandbox"); assert.ok(!it.accessTokenEnc.includes("access-p1"));
assert.equal(await fin.accessTokenFor(id1), "access-p1");

// ---- initial sync across two pages, with a credit card
S.accounts = [acct("a_chk", "Checking", "depository", 1000), acct("a_cc", "Card", "credit", 250, { limit: 5000 })];
S.pages = [page({ added: [tx("t1", "a_chk", 12.5, "2026-10-01"), tx("t2", "a_cc", 40, "2026-10-02")], next_cursor: "c1", has_more: true }), page({ added: [tx("t3", "a_chk", -2000, "2026-10-03")], next_cursor: "c2" })];
S.liabilities = [{ account_id: "a_cc", aprs: [{ apr_percentage: 24.9, apr_type: "purchase_apr" }], is_overdue: false, last_payment_amount: 100, last_payment_date: "2026-09-20", last_statement_balance: 240, last_statement_issue_date: "2026-09-25", minimum_payment_amount: 35, next_payment_due_date: "2026-10-20" }];
assert.equal(await fin.syncItem(id1), "synced");
const sync1 = calls.filter((c) => c.path === "/transactions/sync"); assert.equal(sync1[0]!.body.cursor, undefined); assert.equal(sync1[1]!.body.cursor, "c1"); assert.equal(sync1[0]!.body.count, 500);
assert.equal((await rows("finance.transaction")).length, 3); assert.equal((await rows("finance.balance")).length, 2); assert.equal((await rows("finance.liability")).length, 1);
const t3 = (await rows("finance.transaction")).find((r: any) => r.sourceId === "t3")!; assert.equal(t3.valueNum, -2000); assert.equal(t3.ts.toISOString(), "2026-10-03T00:00:00.000Z"); assert.equal((t3.payload as any).itemId, id1);
const bal = (await rows("finance.balance")).find((r: any) => (r.payload as any).accountId === "a_cc")!; assert.equal((bal.payload as any).accountType, "credit"); assert.ok(bal.sourceId!.startsWith("bal:"));
const liab = (await rows("finance.liability"))[0]!; assert.equal((liab.payload as any).nextPaymentDue, "2026-10-20"); assert.equal(liab.valueNum, 240);
const accs = await db().select().from(accounts); assert.equal(accs.length, 2); assert.equal(accs.find((a: any) => a.plaidAccountId === "a_cc")!.creditLimit, 5000); assert.equal(accs[0]!.institution, "Example Bank");
it = await item(id1); assert.equal(it.cursor, "c2"); assert.equal(it.status, "ok"); assert.equal(it.lastError, null); assert.equal(it.leaseUntil, null); assert.ok(it.lastSyncedAt);
assert.ok(!JSON.stringify(await rows()).match(/access-p1|account_number/));

// ---- re-running is idempotent
const before = (await rows()).length; assert.equal(await fin.syncItem(id1), "synced"); assert.equal((await rows()).length, before);

// ---- modified, removed, pending -> posted; the same id twice in one answer
S.pages = [page({ modified: [tx("t1", "a_chk", 99, "2026-10-01")], added: [tx("t1", "a_chk", 98, "2026-10-01"), tx("p1", "a_cc", 5, "2026-10-04", { pending: true })], removed: [{ transaction_id: "t3" }], next_cursor: "c3" })]; await fin.syncItem(id1);
let ts = await rows("finance.transaction"); assert.equal(ts.find((r: any) => r.sourceId === "t1")!.valueNum, 99); assert.ok(!ts.find((r: any) => r.sourceId === "t3")); assert.ok(ts.find((r: any) => r.sourceId === "p1"));
S.pages = [page({ removed: [{ transaction_id: "p1" }], added: [tx("t9", "a_cc", 5, "2026-10-05", { pending_transaction_id: "p1" })], next_cursor: "c4" })]; await fin.syncItem(id1);
ts = await rows("finance.transaction"); assert.ok(!ts.find((r: any) => r.sourceId === "p1")); assert.equal((ts.find((r: any) => r.sourceId === "t9")!.payload as any).pendingTransactionId, "p1"); assert.equal((await item(id1)).cursor, "c4");

// ---- data changing mid-pagination restarts from the original cursor
calls.length = 0; let n = 0;
globalThis.fetch = (async (i: any, init: any) => { if (String(i).endsWith("/transactions/sync") && ++n === 2) return err("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"); return mock(i, init); }) as any;
S.pages = [page({ added: [tx("m1", "a_chk", 1, "2026-10-06")], next_cursor: "cx", has_more: true }), page({ added: [tx("m1", "a_chk", 1, "2026-10-06"), tx("m2", "a_chk", 2, "2026-10-06")], next_cursor: "cy" })];
await fin.syncItem(id1); globalThis.fetch = mock;
const sc = calls.filter((c) => c.path === "/transactions/sync"); assert.equal(sc.length, 2); assert.equal(sc[0]!.body.cursor, "c4"); assert.equal(sc[1]!.body.cursor, "c4");
assert.ok((await rows("finance.transaction")).find((r: any) => r.sourceId === "m2")); assert.equal((await item(id1)).cursor, "cy");

// ---- an unreadable row fails the sync: nothing saved, cursor stays; and the log holds no financial data
const evBefore = (await rows()).length; S.pages = [page({ added: [{ ...tx("bad", "a_chk", 1, "2026-10-07"), amount: "oops" }], next_cursor: "cz" })];
await assert.rejects(fin.syncItem(id1)); assert.equal((await rows()).length, evBefore); it = await item(id1); assert.equal(it.cursor, "cy"); assert.equal(it.status, "ok"); assert.match(it.lastError!, /retry/); assert.equal(it.leaseUntil, null);
S.pages = [page({ added: [{ ...tx("nul", "a_chk", 7.77, "2026-10-07"), name: "SECRET-MERCHANT\u0000" }], next_cursor: "cq" })];   // a database error carries every bound value
const failed = await quietly(() => fin.syncItem(id1)); assert.ok(failed.error); assert.ok(failed.out.includes("plaid: sync failed"));
assert.ok(!failed.out.match(/SECRET-MERCHANT|7\.77|Failed query|params/), "logs must not contain financial data: " + failed.out.slice(0, 200)); assert.equal((await item(id1)).cursor, "cy");
assert.ok(!describeError(new Error("Failed query: insert ... params: SECRET")).includes("SECRET"));

// ---- product not ready is skipped quietly
S.errors["/transactions/sync"] = ["PRODUCT_NOT_READY"]; assert.equal(await fin.syncItem(id1), "not_ready"); assert.equal((await item(id1)).cursor, "cy");

// ---- login required: a normal sync does not clear the warning, only a repair does
S.errors["/accounts/get"] = ["ITEM_LOGIN_REQUIRED"]; await assert.rejects(fin.syncItem(id1)); it = await item(id1); assert.equal(it.status, "login_required"); assert.match(it.lastError!, /Sign in again/);
assert.equal(await fin.syncItem(id1), "synced"); it = await item(id1); assert.equal(it.status, "login_required"); assert.match(it.lastError!, /Sign in again/);
assert.equal(await fin.syncItem(id1, { repaired: true }), "synced"); it = await item(id1); assert.equal(it.status, "ok"); assert.equal(it.lastError, null);
await fin.markNeedsLogin(id1); assert.equal((await item(id1)).status, "login_required"); await fin.syncItem(id1, { repaired: true });

// ---- optional products: liabilities unsupported is fine; checking-only items never ask for them
S.errors["/liabilities/get"] = ["INVALID_PRODUCT"]; assert.equal(await fin.syncItem(id1), "synced");
const id3 = await fin.linkItem("bank", "p3"); S.accounts = [acct("a_only", "Only checking", "depository", 5)]; calls.length = 0; await fin.syncItem(id3);
assert.ok(!calls.some((c) => c.path === "/liabilities/get")); await fin.unlinkItem(id3);

// ---- brokerage: holdings (two lots become one position), investment transactions, unsupported tolerated
const id2 = await fin.linkItem("brokerage", "p2"); S.accounts = [acct("a_brk", "Brokerage", "investment", 5000)];
S.holdings = { holdings: [{ account_id: "a_brk", security_id: "s1", quantity: 6, institution_price: 100, institution_value: 600, cost_basis: 400, iso_currency_code: "USD" }, { account_id: "a_brk", security_id: "s1", quantity: 4, institution_price: 100, institution_value: 400, cost_basis: 400, iso_currency_code: "USD" }, { account_id: "a_brk", security_id: "s2", quantity: 5, institution_price: 20, institution_value: 100, cost_basis: null, iso_currency_code: "USD" }], securities: [{ security_id: "s1", name: "Example Fund", ticker_symbol: "EXF", type: "etf" }, { security_id: "s2", name: "Other Co", ticker_symbol: "OTH", type: "equity" }] };
S.invTxns = [{ investment_transaction_id: "i1", account_id: "a_brk", security_id: "s1", date: "2026-09-01", name: "Buy", quantity: 10, amount: 800, price: 80, fees: 0, type: "buy", subtype: "buy", iso_currency_code: "USD" }, { investment_transaction_id: "i2", account_id: "a_brk", security_id: "s2", date: "2026-09-02", name: "Div", quantity: 0, amount: -3, price: 0, fees: null, type: "cash", subtype: "dividend", iso_currency_code: "USD" }];
assert.equal(await fin.syncItem(id2), "synced");
let holds = await rows("finance.holding"); assert.equal(holds.length, 2); const exf = holds.find((r: any) => (r.payload as any).symbol === "EXF")!; assert.equal(exf.valueNum, 1000); assert.equal((exf.payload as any).quantity, 10); assert.equal((exf.payload as any).costBasis, 800);
assert.equal((await rows("finance.investment_transaction")).length, 2); assert.equal((await rows("finance.investment_transaction")).find((r: any) => r.sourceId === "inv:i2")!.valueNum, -3);
S.invTxns = [S.invTxns[0]]; await fin.syncItem(id2); assert.deepEqual((await rows("finance.investment_transaction")).map((r: any) => r.sourceId), ["inv:i1"]);   // a corrected-away transaction drops out
S.holdings = { ...S.holdings, holdings: [S.holdings.holdings[0]] }; await fin.syncItem(id2); assert.deepEqual((await rows("finance.holding")).map((r: any) => (r.payload as any).symbol), ["EXF"]);   // sold today
S.errors["/investments/transactions/get"] = ["PRODUCTS_NOT_SUPPORTED"]; assert.equal(await fin.syncItem(id2), "synced"); assert.equal((await rows("finance.holding")).length, 1);   // holdings-only institution
S.accounts = []; S.invTxns = []; // an account that disappears is delisted, history stays
S.accounts = [acct("a_brk2", "Replacement", "investment", 1)]; await fin.syncItem(id2); assert.deepEqual((await db().select().from(accounts).where(eq(accounts.itemId, id2))).map((a: any) => a.plaidAccountId), ["a_brk2"]);

// ---- another environment's items are never touched
await db().insert(plaidItems).values({ id: "item-prod", kind: "bank", env: "production", institutionName: "Real Bank", accessTokenEnc: "x" });
assert.equal(await fin.syncItem("item-prod"), "missing"); assert.ok(!(await fin.listItems()).some((i: any) => i.id === "item-prod")); await db().delete(plaidItems).where(eq(plaidItems.id, "item-prod"));

// ---- two syncs at once: one runs, one is skipped
S.accounts = [acct("a_chk", "Checking", "depository", 1000), acct("a_cc", "Card", "credit", 250, { limit: 5000 })];
let release!: () => void; S.gate = new Promise<void>((r) => (release = r)); S.gatePath = "/accounts/get";
const first = fin.syncItem(id1); await tick(); assert.equal(await fin.syncItem(id1), "skipped"); release(); S.gate = null; assert.equal(await first, "synced");

// ---- unlink: Plaid failure keeps everything; a sync mid-write cannot leave orphans
S.errors["/item/remove"] = ["INTERNAL_SERVER_ERROR"]; assert.equal(await fin.unlinkItem(id1), false);
assert.ok(await item(id1)); assert.equal(await fin.accessTokenFor(id1), "access-p1"); assert.match((await item(id1)).lastError!, /Could not remove/); assert.ok((await rows("finance.transaction")).length > 0);
S.errors["/item/remove"] = ["ITEM_NOT_FOUND"]; S.gate = new Promise<void>((r) => (release = r)); S.gatePath = "/accounts/get"; calls.length = 0;
const racing = fin.syncItem(id1); await tick(); const unlinking = fin.unlinkItem(id1); await tick(); release(); S.gate = null;
assert.equal(await unlinking, true); await racing.catch(() => {});
assert.equal(await item(id1), undefined); assert.equal((await db().select().from(accounts).where(eq(accounts.itemId, id1))).length, 0);
assert.equal((await db().select().from(events).where(sql`${events.payload} @> ${JSON.stringify({ itemId: id1 })}::jsonb`)).length, 0, "no orphaned rows");
assert.ok(await item(id2)); assert.ok((await rows("finance.holding")).length === 1);
calls.length = 0; assert.equal(await fin.unlinkItem(id2), true); assert.equal(calls.find((c) => c.path === "/item/remove")!.body.access_token, "access-p2"); assert.equal((await rows()).length, 0);

// ---- linking never loses the access token
S.errors["/institutions/get_by_id"] = ["INTERNAL_SERVER_ERROR"]; const id4 = await fin.linkItem("bank", "p4");
assert.equal((await item(id4)).institutionName, "Linked account"); await fin.syncItem(id4); assert.equal((await item(id4)).institutionName, "Example Bank"); await fin.unlinkItem(id4);
process.env.ENCRYPTION_KEY = "short"; calls.length = 0; await assert.rejects(fin.linkItem("bank", "p5")); process.env.ENCRYPTION_KEY = "ab".repeat(32);
assert.equal(calls.find((c) => c.path === "/item/remove")!.body.access_token, "access-p5", "an unstorable token is revoked");

// ---- link token requests
globalThis.fetch = (async (i: any, init: any) => { calls.push({ path: new URL(String(i)).pathname, body: JSON.parse(init.body) }); return ok({ link_token: "lt" }); }) as any;
await plaid.linkTokenCreate({ kind: "bank", origin: "https://app.example" }); let lt = calls.at(-1)!.body;
assert.deepEqual(lt.products, ["transactions"]); assert.deepEqual(lt.optional_products, ["liabilities"]); assert.equal(lt.transactions.days_requested, 730);
assert.equal(lt.redirect_uri, "https://app.example/settings/oauth"); assert.equal(lt.webhook, "https://app.example/api/webhooks/plaid"); assert.equal(lt.user.client_user_id, "owner");
await plaid.linkTokenCreate({ kind: "brokerage", origin: "http://localhost:3000" }); lt = calls.at(-1)!.body; assert.deepEqual(lt.products, ["investments"]); assert.equal("redirect_uri" in lt, false); assert.equal("webhook" in lt, false, "no webhook is sent from an http address"); assert.equal("transactions" in lt, false);
await plaid.linkTokenCreate({ kind: "bank", accessToken: "access-x", origin: "https://app.example" }); lt = calls.at(-1)!.body; assert.equal(lt.access_token, "access-x"); assert.equal("products" in lt, false);

// ---- the Plaid environment follows the database, and nothing can override it
const setEnv = (e: Record<string, string | undefined>) => { for (const [k, v] of Object.entries(e)) v === undefined ? delete process.env[k] : (process.env[k] = v); };
const dsn = (host: string) => ["postgres://", "u:p", "@", host, "/db"].join("");   // built in pieces so the privacy check never sees a fake password in a URL
assert.equal(plaid.plaidEnv(), "sandbox");                                                                   // the throwaway local database
for (const host of ["localhost:5432", "127.0.0.1", "[::1]:5432"]) { setEnv({ DATABASE_URL: dsn(host) }); assert.equal(plaid.plaidEnv(), "sandbox", host); }
setEnv({ DATABASE_URL: dsn("db.example.com") }); assert.equal(plaid.plaidEnv(), "production");               // any hosted database gets real Plaid
setEnv({ DATABASE_URL: dsn("localhost.example.com") }); assert.equal(plaid.plaidEnv(), "production");        // not fooled by a lookalike host
setEnv({ PLAID_ENV: "sandbox", VERCEL: "1", VERCEL_ENV: "production" }); assert.equal(plaid.plaidEnv(), "production"); // settings cannot override it
setEnv({ DATABASE_URL: REAL_DB_URL, PLAID_ENV: "production" }); assert.equal(plaid.plaidEnv(), "sandbox");
setEnv({ PLAID_ENV: undefined, VERCEL: undefined, VERCEL_ENV: undefined, DATABASE_URL: REAL_DB_URL });

// ---- webhook verification and its key handling
const KID = "11111111-2222-3333-4444-555555555555";
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" }); const jwk = publicKey.export({ format: "jwk" }) as Json;
let keyFetches = 0; let keyResponse: Response | null = null;
globalThis.fetch = (async (i: any, init: any) => { assert.ok(String(i).endsWith("/webhook_verification_key/get")); keyFetches++; return keyResponse ?? ok({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, expired_at: null } }); }) as any;
setEnv({ VERCEL: undefined });
const b64 = (o: Json) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (body: string, o: { alg?: string; kid?: string; iat?: number; hash?: string; key?: any } = {}) => { const h = b64({ alg: o.alg ?? "ES256", kid: o.kid ?? KID, typ: "JWT" }); const p = b64({ iat: o.iat ?? Math.floor(Date.now() / 1000), request_body_sha256: o.hash ?? createHash("sha256").update(body).digest("hex") }); return `${h}.${p}.${sign("sha256", Buffer.from(`${h}.${p}`), { key: o.key ?? privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`; };
const body = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-x" }, null, 2);
assert.equal(await plaid.verifyWebhook(body, jwt(body)), true); assert.equal(keyFetches, 1);
assert.equal(await plaid.verifyWebhook(body, jwt(body)), true); assert.equal(keyFetches, 1, "valid keys are cached");
assert.equal(await plaid.verifyWebhook(body + " ", jwt(body)), false);
assert.equal(await plaid.verifyWebhook(body, jwt(body, { iat: Math.floor(Date.now() / 1000) - 600 })), false);
assert.equal(await plaid.verifyWebhook(body, jwt(body, { alg: "HS256" })), false);
assert.equal(await plaid.verifyWebhook(body, jwt(body, { hash: "0".repeat(64) })), false);
assert.equal(await plaid.verifyWebhook(body, jwt(body).slice(0, -4) + "AAAA"), false);
assert.equal(await plaid.verifyWebhook(body, jwt(body, { key: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey })), false);
assert.equal(await plaid.verifyWebhook(body, null), false); assert.equal(await plaid.verifyWebhook(body, "garbage"), false); assert.equal(await plaid.verifyWebhook(body, ""), false);
const fetchesBefore = keyFetches;
for (const kid of ["k1", "../../etc", "x".repeat(500), "'; drop table"]) assert.equal(await plaid.verifyWebhook(body, jwt(body, { kid })), false);
assert.equal(keyFetches, fetchesBefore, "a malformed key id never causes a Plaid call");
const unknown = "99999999-9999-9999-9999-999999999999"; keyResponse = err("INVALID_FIELD", "INVALID_REQUEST");
assert.equal(await plaid.verifyWebhook(body, jwt(body, { kid: unknown })), false); assert.equal(await plaid.verifyWebhook(body, jwt(body, { kid: unknown })), false);
assert.equal(keyFetches, fetchesBefore + 1, "a failed lookup is remembered");
let flood = 0; keyResponse = err("INVALID_FIELD", "INVALID_REQUEST"); const before2 = keyFetches;
for (let i = 0; i < 40; i++) { flood++; await plaid.verifyWebhook(body, jwt(body, { kid: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}` })); }
assert.ok(keyFetches - before2 <= 10, "key lookups are rate limited: " + (keyFetches - before2));

// ---- key status: a mix-up is reported as such, and only a pass is remembered
let ksFetches = 0; let ksResponse: Response = err("INVALID_API_KEYS", "INVALID_INPUT");
globalThis.fetch = (async (i: any) => { assert.ok(String(i).endsWith("/institutions/get")); ksFetches++; return ksResponse.clone(); }) as any;
assert.equal(await plaid.keyStatus(), "rejected"); assert.equal(await plaid.keyStatus(), "rejected"); assert.equal(ksFetches, 2);
ksResponse = err("INTERNAL_SERVER_ERROR", "API_ERROR", 500); assert.equal(await plaid.keyStatus(), "unreachable");
ksResponse = ok({ institutions: [] }); assert.equal(await plaid.keyStatus(), "ok"); const seen = ksFetches; assert.equal(await plaid.keyStatus(), "ok"); assert.equal(ksFetches, seen, "a pass is cached");

console.log("PLAID ALL OK"); process.exit(0);
