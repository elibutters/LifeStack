import "server-only";
import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { z } from "zod";

// Thin Plaid client: plain HTTPS calls, every response checked against a schema.
// The Plaid environment follows the database, so real and fake data can never mix: a local database
// only ever sees Plaid's fake Sandbox, and any hosted database (the live one, whether reached from
// the deployed app or from local development) only ever sees real Plaid. It cannot be overridden.
export type PlaidEnv = "sandbox" | "production";

export function plaidEnv(): PlaidEnv {
  const localDatabase = /(\/\/|@)(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(process.env.DATABASE_URL ?? "");
  return localDatabase ? "sandbox" : "production";
}

const secret = () => (plaidEnv() === "production" ? process.env.PLAID_PRODUCTION_SECRET : process.env.PLAID_SANDBOX_SECRET);

export const plaidConfigured = () => !!process.env.PLAID_CLIENT_ID && !!secret();

export class PlaidError extends Error {
  constructor(
    public code: string,
    public type: string,
  ) {
    super(`plaid ${type}: ${code}`);
  }
}

async function call<S extends z.ZodTypeAny>(path: string, body: Record<string, unknown>, schema: S): Promise<z.infer<S>> {
  const res = await fetch(`https://${plaidEnv()}.plaid.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: process.env.PLAID_CLIENT_ID, secret: secret(), ...body }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json as { error_code?: string; error_type?: string };
    throw new PlaidError(e.error_code ?? String(res.status), e.error_type ?? "UNKNOWN");
  }
  // Anything unexpected is an error, never silently dropped data.
  return schema.parse(json);
}

const num = z.number().nullish();
const str = z.string().nullish();

export const Account = z.object({
  account_id: z.string(),
  name: z.string(),
  official_name: str,
  type: z.string(),
  subtype: str,
  balances: z.object({ current: num, available: num, limit: num, iso_currency_code: str }),
});
export type PlaidAccount = z.infer<typeof Account>;

export const Txn = z.object({
  transaction_id: z.string(),
  account_id: z.string(),
  amount: z.number(),
  date: z.string(),
  authorized_date: str,
  name: z.string(),
  merchant_name: str,
  pending: z.boolean(),
  pending_transaction_id: str,
  iso_currency_code: str,
  personal_finance_category: z.object({ primary: z.string(), detailed: z.string() }).nullish(),
});
export type PlaidTxn = z.infer<typeof Txn>;

const Security = z.object({ security_id: z.string(), name: str, ticker_symbol: str, type: str });
const Holding = z.object({
  account_id: z.string(),
  security_id: z.string(),
  quantity: z.number(),
  institution_price: z.number(),
  institution_value: z.number(),
  cost_basis: num,
  iso_currency_code: str,
});
export const InvTxn = z.object({
  investment_transaction_id: z.string(),
  account_id: z.string(),
  security_id: str,
  date: z.string(),
  name: z.string(),
  quantity: z.number(),
  amount: z.number(),
  price: z.number(),
  fees: num,
  type: z.string(),
  subtype: str,
  iso_currency_code: str,
});
const Credit = z.object({
  account_id: z.string().nullable(),
  aprs: z.array(z.object({ apr_percentage: z.number(), apr_type: z.string() })).nullish(),
  is_overdue: z.boolean().nullish(),
  last_payment_amount: num,
  last_payment_date: str,
  last_statement_balance: num,
  last_statement_issue_date: str,
  minimum_payment_amount: num,
  next_payment_due_date: str,
});

export type KeyStatus = "ok" | "rejected" | "unreachable";
let verifiedAt = 0;

// Whether Plaid accepts this deployment's keys, using a free call. Shown in Settings so a mix-up
// (such as the sandbox and production secrets swapped) is visible at once. A pass is remembered
// for five minutes. The request itself is fixed and valid, so "invalid field" means a malformed key.
export async function keyStatus(): Promise<KeyStatus> {
  if (Date.now() - verifiedAt < 5 * 60 * 1000) return "ok";
  try {
    await call("/institutions/get", { count: 1, offset: 0, country_codes: ["US"] }, z.object({ institutions: z.array(z.unknown()) }));
    verifiedAt = Date.now();
    return "ok";
  } catch (e) {
    return e instanceof PlaidError && ["INVALID_API_KEYS", "INVALID_CLIENT_ID", "INVALID_SECRET", "INVALID_FIELD"].includes(e.code) ? "rejected" : "unreachable";
  }
}

export type PlaidKind = "bank" | "brokerage";

export const linkTokenCreate = (opts: { kind: PlaidKind; accessToken?: string; origin: string }) => {
  // Webhooks and the OAuth return page need a public https address; from localhost neither is sent.
  const publicUrls = opts.origin.startsWith("https://")
    ? { webhook: `${opts.origin}/api/webhooks/plaid`, redirect_uri: `${opts.origin}/settings/oauth` }
    : {};
  const base = {
    client_name: "Life Stack",
    language: "en",
    country_codes: ["US"],
    user: { client_user_id: "owner" },
    ...publicUrls,
  };
  const body = opts.accessToken
    ? { ...base, access_token: opts.accessToken } // update mode: re-authenticate an existing item
    : opts.kind === "bank"
      ? { ...base, products: ["transactions"], optional_products: ["liabilities"], transactions: { days_requested: 730 } }
      : { ...base, products: ["investments"] };
  return call("/link/token/create", body, z.object({ link_token: z.string() }));
};

export const publicTokenExchange = (publicToken: string) =>
  call("/item/public_token/exchange", { public_token: publicToken }, z.object({ access_token: z.string(), item_id: z.string() }));

export async function institutionOf(accessToken: string): Promise<{ id: string | null; name: string }> {
  const item = await call("/item/get", { access_token: accessToken }, z.object({ item: z.object({ institution_id: str }) }));
  const id = item.item.institution_id ?? null;
  if (!id) return { id, name: "Linked account" };
  const inst = await call(
    "/institutions/get_by_id",
    { institution_id: id, country_codes: ["US"] },
    z.object({ institution: z.object({ name: z.string() }) }),
  );
  return { id, name: inst.institution.name };
}

export const accountsGet = (accessToken: string) =>
  call("/accounts/get", { access_token: accessToken }, z.object({ accounts: z.array(Account) }));

const SyncPage = z.object({
  added: z.array(z.unknown()),
  modified: z.array(z.unknown()),
  removed: z.array(z.object({ transaction_id: z.string() })),
  next_cursor: z.string(),
  has_more: z.boolean(),
});

const parseAll = <T extends z.ZodTypeAny>(schema: T, rows: unknown[]): z.infer<T>[] =>
  rows.map((r) => schema.parse(r)); // one unreadable row fails the whole sync

// Pulls every page since `cursor`. If Plaid reports data changed mid-pagination the loop restarts
// from the original cursor, as Plaid requires.
export async function transactionsSyncAll(accessToken: string, cursor: string | null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const added: PlaidTxn[] = [];
    const modified: PlaidTxn[] = [];
    const removed: string[] = [];
    let next = cursor;
    try {
      for (let page = 0; page < 200; page++) {
        const body = await call(
          "/transactions/sync",
          {
            access_token: accessToken,
            count: 500,
            options: { include_personal_finance_category: true },
            ...(next ? { cursor: next } : {}),
          },
          SyncPage,
        );
        added.push(...parseAll(Txn, body.added));
        modified.push(...parseAll(Txn, body.modified));
        removed.push(...body.removed.map((r) => r.transaction_id));
        next = body.next_cursor;
        if (!body.has_more) return { added, modified, removed, cursor: next };
      }
      throw new Error("transaction history too large to sync");
    } catch (e) {
      if (e instanceof PlaidError && e.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") continue;
      throw e;
    }
  }
  throw new Error("transactions kept changing during sync");
}

export async function holdingsGet(accessToken: string) {
  const r = await call(
    "/investments/holdings/get",
    { access_token: accessToken },
    z.object({ holdings: z.array(z.unknown()), securities: z.array(z.unknown()) }),
  );
  return { holdings: parseAll(Holding, r.holdings), securities: parseAll(Security, r.securities) };
}

export async function investmentTransactionsGetAll(accessToken: string, startDate: string, endDate: string) {
  const out: z.infer<typeof InvTxn>[] = [];
  const securities: z.infer<typeof Security>[] = [];
  for (let offset = 0, page = 0; page < 100; page++) {
    const r = await call(
      "/investments/transactions/get",
      { access_token: accessToken, start_date: startDate, end_date: endDate, options: { count: 500, offset } },
      z.object({
        investment_transactions: z.array(z.unknown()),
        securities: z.array(z.unknown()),
        total_investment_transactions: z.number(),
      }),
    );
    out.push(...parseAll(InvTxn, r.investment_transactions));
    securities.push(...parseAll(Security, r.securities));
    offset += r.investment_transactions.length;
    if (r.investment_transactions.length === 0 || offset >= r.total_investment_transactions) return { transactions: out, securities };
  }
  throw new Error("investment history too large to sync");
}

export async function creditLiabilitiesGet(accessToken: string) {
  const r = await call(
    "/liabilities/get",
    { access_token: accessToken },
    z.object({ liabilities: z.object({ credit: z.array(z.unknown()).nullish() }) }),
  );
  return parseAll(Credit, r.liabilities.credit ?? []);
}

export const itemRemove = (accessToken: string) => call("/item/remove", { access_token: accessToken }, z.object({}).passthrough());

// ---- webhooks
const b64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");
// Verification keys: valid ones are cached for an hour, failed lookups for a minute, and a single
// instance makes at most 10 lookups a minute, so unsigned traffic cannot drive Plaid calls.
const KID = /^[0-9a-f-]{36}$/i;
const keyCache = new Map<string, { key: ReturnType<typeof createPublicKey>; at: number }>();
const missCache = new Map<string, number>();
let lookups: number[] = [];

async function verificationKey(kid: string) {
  if (!KID.test(kid)) return null;
  const now = Date.now();
  const hit = keyCache.get(kid);
  if (hit && now - hit.at < 60 * 60 * 1000) return hit.key;
  const miss = missCache.get(kid);
  if (miss && now - miss < 60 * 1000) return null;
  lookups = lookups.filter((t) => now - t < 60 * 1000);
  if (lookups.length >= 10) return null;
  lookups.push(now);
  try {
    const r = await call(
      "/webhook_verification_key/get",
      { key_id: kid },
      z.object({ key: z.object({ kty: z.string(), crv: z.string(), x: z.string(), y: z.string(), expired_at: z.string().nullish() }) }),
    );
    if (r.key.expired_at) throw new Error("expired");
    const key = createPublicKey({ key: { kty: r.key.kty, crv: r.key.crv, x: r.key.x, y: r.key.y }, format: "jwk" });
    keyCache.set(kid, { key, at: now });
    return key;
  } catch {
    missCache.set(kid, now);
    return null;
  }
}

// Checks Plaid's signed header: ES256 signature, issued within 5 minutes, and the body hash.
export async function verifyWebhook(rawBody: string, header: string | null): Promise<boolean> {
  try {
    const [h, p, sig] = (header ?? "").split(".");
    if (!h || !p || !sig) return false;
    const head = JSON.parse(b64(h)) as { alg?: string; kid?: string };
    if (head.alg !== "ES256" || typeof head.kid !== "string") return false;
    const key = await verificationKey(head.kid);
    if (!key) return false;
    const ok = verify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"));
    if (!ok) return false;
    const claims = JSON.parse(b64(p)) as { iat?: number; request_body_sha256?: string };
    if (typeof claims.iat !== "number" || Math.abs(Date.now() / 1000 - claims.iat) > 300) return false;
    const want = Buffer.from(claims.request_body_sha256 ?? "");
    const got = Buffer.from(createHash("sha256").update(rawBody).digest("hex"));
    return want.length === got.length && timingSafeEqual(want, got);
  } catch {
    return false;
  }
}
