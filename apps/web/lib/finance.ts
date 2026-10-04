import "server-only";
import { and, count, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { accounts, events, plaidItems, type Db } from "@lifestack/db";
import { decrypt, encrypt } from "./crypto";
import { db } from "./db";
import { addDays, startOfDay, ymd } from "./dates";
import { describeError } from "./errors";
import {
  accountsGet,
  creditLiabilitiesGet,
  holdingsGet,
  institutionOf,
  investmentTransactionsGetAll,
  itemRemove,
  plaidEnv,
  PlaidError,
  publicTokenExchange,
  transactionsSyncAll,
  type PlaidKind,
} from "./plaid";

// Finance data lives in the shared `events` table (domain "finance", source "plaid"), so it can be
// joined with everything else. Every payload carries `itemId` so an unlink can remove it all.
//   finance.transaction             value = amount (Plaid's sign: positive is money out), ts = date
//   finance.balance                 value = current balance, one row per account per day. For credit
//                                   cards the value is what is owed, so read `accountType` first.
//   finance.holding                 value = market value, one row per position per day
//   finance.investment_transaction  value = amount, ts = date
//   finance.liability               value = last statement balance, credit cards, one row per day
// source_id is unique per source across all kinds, so snapshots are prefixed: bal:, liab:, hold:, inv:
// (transactions keep Plaid's own transaction_id). Account numbers are never stored.
const PLAID = "plaid";
const PLACEHOLDER = "Linked account";
const LEASE = "90 seconds"; // a little over the 60s function limit, so a killed run frees itself soon
const BUDGET_MS = 45_000; // a daily run stops starting new institutions after this
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type EventRow = typeof events.$inferInsert;

const SKIPPABLE = new Set(["PRODUCTS_NOT_SUPPORTED", "PRODUCT_NOT_READY", "ADDITIONAL_CONSENT_REQUIRED", "INVALID_PRODUCT", "PRODUCT_NOT_ENABLED", "NO_LIABILITY_ACCOUNTS", "NO_INVESTMENT_ACCOUNTS"]);
const REAUTH = "Sign in again at this institution to keep syncing.";

// jsonb containment, which the GIN index on payload can serve.
const ofItem = (id: string) => sql`${events.payload} @> ${JSON.stringify({ itemId: id })}::jsonb`;

export async function listItems() {
  return db().select().from(plaidItems).where(eq(plaidItems.env, plaidEnv())).orderBy(plaidItems.createdAt);
}

export async function linkItem(kind: PlaidKind, publicToken: string): Promise<string> {
  const { access_token, item_id } = await publicTokenExchange(publicToken);
  // The public token is single use, so the access token must be stored (or the item revoked)
  // before anything else can fail.
  try {
    await db()
      .insert(plaidItems)
      .values({ id: item_id, kind, env: plaidEnv(), institutionName: PLACEHOLDER, accessTokenEnc: encrypt(access_token) })
      .onConflictDoUpdate({ target: plaidItems.id, set: { accessTokenEnc: encrypt(access_token), status: "ok", lastError: null } });
  } catch (e) {
    await itemRemove(access_token).catch(() => {});
    throw e;
  }
  try {
    const inst = await institutionOf(access_token);
    await db().update(plaidItems).set({ institutionId: inst.id, institutionName: inst.name }).where(eq(plaidItems.id, item_id));
  } catch (e) {
    console.error("plaid: could not look up the institution name", describeError(e)); // filled in by the next sync
  }
  return item_id;
}

export async function accessTokenFor(itemId: string): Promise<string | null> {
  const [item] = await db().select({ enc: plaidItems.accessTokenEnc }).from(plaidItems).where(eq(plaidItems.id, itemId));
  return item ? decrypt(item.enc) : null;
}

// Returns false (and keeps everything) if access could not be revoked at Plaid, so the item is
// never left billing with its only token thrown away.
export async function unlinkItem(itemId: string): Promise<boolean> {
  const [item] = await db().select().from(plaidItems).where(eq(plaidItems.id, itemId));
  if (!item) return true;
  try {
    await itemRemove(decrypt(item.accessTokenEnc));
  } catch (e) {
    if (!(e instanceof PlaidError && e.code === "ITEM_NOT_FOUND")) {
      console.error("plaid: item/remove failed", describeError(e));
      await db()
        .update(plaidItems)
        .set({ lastError: "Could not remove this connection at Plaid. Try again." })
        .where(eq(plaidItems.id, itemId))
        .catch(() => {});
      return false;
    }
  }
  await db().transaction(async (tx) => {
    // Waits for a sync that is mid-write, so its rows are removed with everything else.
    await tx.select({ id: plaidItems.id }).from(plaidItems).where(eq(plaidItems.id, itemId)).for("update");
    await tx.delete(events).where(and(eq(events.source, PLAID), ofItem(itemId)));
    await tx.delete(plaidItems).where(eq(plaidItems.id, itemId)); // accounts go with it
  });
  return true;
}

export async function markNeedsLogin(itemId: string) {
  await db().update(plaidItems).set({ status: "login_required", lastError: REAUTH }).where(eq(plaidItems.id, itemId));
}

async function claim(itemId: string): Promise<boolean> {
  const got = await db()
    .update(plaidItems)
    .set({ leaseUntil: sql`now() + ${sql.raw(`interval '${LEASE}'`)}` })
    .where(and(eq(plaidItems.id, itemId), sql`(${plaidItems.leaseUntil} is null or ${plaidItems.leaseUntil} < now())`))
    .returning({ id: plaidItems.id });
  return got.length > 0;
}

async function release(itemId: string) {
  try {
    await db().update(plaidItems).set({ leaseUntil: null }).where(eq(plaidItems.id, itemId));
  } catch {
    // The lease expires by itself.
  }
}

async function upsertEvents(tx: Tx, rows: EventRow[]) {
  const unique = [...new Map(rows.map((r) => [r.sourceId as string, r])).values()]; // last one wins
  for (let i = 0; i < unique.length; i += 500) {
    await tx
      .insert(events)
      .values(unique.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [events.source, events.sourceId],
        set: { ts: sql`excluded.ts`, valueNum: sql`excluded.value_num`, payload: sql`excluded.payload` },
      });
  }
}

export type SyncOutcome = "synced" | "skipped" | "missing" | "not_ready";

// Reads everything from Plaid first, then writes it in one transaction together with the new sync
// position, so a failed or partial sync never leaves half the data or skips transactions.
// `repaired` is set only when the owner just re-authenticated or Plaid said the login is repaired;
// a normal sync keeps a "sign in again" warning in place until then.
export async function syncItem(itemId: string, opts: { repaired?: boolean } = {}): Promise<SyncOutcome> {
  if (!(await claim(itemId))) {
    const [exists] = await db().select({ id: plaidItems.id }).from(plaidItems).where(eq(plaidItems.id, itemId));
    return exists ? "skipped" : "missing";
  }
  try {
    const [item] = await db()
      .select()
      .from(plaidItems)
      .where(and(eq(plaidItems.id, itemId), eq(plaidItems.env, plaidEnv())));
    if (!item) return "missing";
    const token = decrypt(item.accessTokenEnc);
    const today = ymd(new Date());
    const todayTs = startOfDay(today);
    const rows: EventRow[] = [];
    const removed: string[] = [];
    let cursor = item.cursor;
    let holdingKeep: string[] | null = null;
    let invKeep: string[] | null = null;
    const invWindowStart = startOfDay(addDays(today, -730));
    let name = item.institutionName;
    let institutionId = item.institutionId;
    const ev = (key: string, ts: Date, value: number | null, sourceId: string, payload: Record<string, unknown>): EventRow => ({
      ts,
      domain: "finance",
      key,
      valueNum: value,
      payload: { itemId, ...payload },
      source: PLAID,
      sourceId,
    });

    if (!item.institutionId) {
      try {
        const inst = await institutionOf(token);
        name = inst.name;
        institutionId = inst.id;
      } catch {
        // Cosmetic; tried again next time.
      }
    }

    const { accounts: accts } = await accountsGet(token);
    try {
      if (item.kind === "bank") {
        const r = await transactionsSyncAll(token, item.cursor);
        cursor = r.cursor;
        removed.push(...r.removed);
        for (const t of [...r.added, ...r.modified]) {
          rows.push(
            ev("finance.transaction", startOfDay(t.date), t.amount, t.transaction_id, {
              accountId: t.account_id,
              name: t.name,
              merchant: t.merchant_name ?? null,
              pending: t.pending,
              pendingTransactionId: t.pending_transaction_id ?? null,
              category: t.personal_finance_category?.primary ?? null,
              categoryDetailed: t.personal_finance_category?.detailed ?? null,
              authorizedDate: t.authorized_date ?? null,
              currency: t.iso_currency_code ?? null,
            }),
          );
        }
        if (accts.some((a) => a.type === "credit")) {
          try {
            for (const c of await creditLiabilitiesGet(token)) {
              if (!c.account_id) continue;
              rows.push(
                ev("finance.liability", todayTs, c.last_statement_balance ?? null, `liab:${c.account_id}:${today}`, {
                  accountId: c.account_id,
                  accountType: "credit",
                  minimumPayment: c.minimum_payment_amount ?? null,
                  nextPaymentDue: c.next_payment_due_date ?? null,
                  lastStatementDate: c.last_statement_issue_date ?? null,
                  lastPaymentAmount: c.last_payment_amount ?? null,
                  lastPaymentDate: c.last_payment_date ?? null,
                  isOverdue: c.is_overdue ?? null,
                  aprs: (c.aprs ?? []).map((a) => ({ type: a.apr_type, percent: a.apr_percentage })),
                }),
              );
            }
          } catch (e) {
            if (!(e instanceof PlaidError && SKIPPABLE.has(e.code))) throw e;
          }
        }
      } else {
        const h = await holdingsGet(token);
        const sec = new Map(h.securities.map((s) => [s.security_id, s]));
        // Several lots of the same security in one account become one position.
        const positions = new Map<string, { accountId: string; securityId: string; quantity: number; value: number; price: number; cost: number | null; currency: string | null }>();
        for (const p of h.holdings) {
          const k = `${p.account_id}:${p.security_id}`;
          const prev = positions.get(k);
          positions.set(k, {
            accountId: p.account_id,
            securityId: p.security_id,
            quantity: (prev?.quantity ?? 0) + p.quantity,
            value: (prev?.value ?? 0) + p.institution_value,
            price: p.institution_price,
            cost: prev ? (prev.cost != null && p.cost_basis != null ? prev.cost + p.cost_basis : null) : (p.cost_basis ?? null),
            currency: p.iso_currency_code ?? null,
          });
        }
        holdingKeep = [];
        for (const p of positions.values()) {
          const s = sec.get(p.securityId);
          const sourceId = `hold:${p.accountId}:${p.securityId}:${today}`;
          holdingKeep.push(sourceId);
          rows.push(
            ev("finance.holding", todayTs, p.value, sourceId, {
              accountId: p.accountId,
              symbol: s?.ticker_symbol ?? null,
              name: s?.name ?? null,
              securityType: s?.type ?? null,
              quantity: p.quantity,
              price: p.price,
              costBasis: p.cost,
              currency: p.currency,
            }),
          );
        }
        try {
          const it = await investmentTransactionsGetAll(token, addDays(today, -730), today);
          const isec = new Map(it.securities.map((s) => [s.security_id, s]));
          invKeep = [];
          for (const t of it.transactions) {
            const s = t.security_id ? isec.get(t.security_id) : undefined;
            const sourceId = `inv:${t.investment_transaction_id}`;
            invKeep.push(sourceId);
            rows.push(
              ev("finance.investment_transaction", startOfDay(t.date), t.amount, sourceId, {
                accountId: t.account_id,
                name: t.name,
                symbol: s?.ticker_symbol ?? null,
                type: t.type,
                subtype: t.subtype ?? null,
                quantity: t.quantity,
                price: t.price,
                fees: t.fees ?? null,
                currency: t.iso_currency_code ?? null,
              }),
            );
          }
        } catch (e) {
          // Some institutions give holdings only; that is fine.
          if (!(e instanceof PlaidError && SKIPPABLE.has(e.code) && e.code !== "PRODUCT_NOT_READY")) throw e;
        }
      }
    } catch (e) {
      if (e instanceof PlaidError && e.code === "PRODUCT_NOT_READY") return "not_ready"; // the webhook calls back
      throw e;
    }

    const wrote = await db().transaction(async (tx) => {
      const [live] = await tx.select({ id: plaidItems.id }).from(plaidItems).where(eq(plaidItems.id, itemId)).for("share");
      if (!live) return false; // unlinked while we were running

      for (const a of accts) {
        const values = {
          name: a.name,
          institution: name,
          type: a.type,
          subtype: a.subtype ?? null,
          itemId,
          plaidAccountId: a.account_id,
          currency: a.balances.iso_currency_code ?? null,
          currentBalance: a.balances.current ?? null,
          availableBalance: a.balances.available ?? null,
          creditLimit: a.balances.limit ?? null,
          balanceAt: new Date(),
        };
        await tx.insert(accounts).values(values).onConflictDoUpdate({ target: accounts.plaidAccountId, set: values });
        if (a.balances.current != null) {
          rows.push(
            ev("finance.balance", todayTs, a.balances.current, `bal:${a.account_id}:${today}`, {
              accountId: a.account_id,
              accountType: a.type,
              subtype: a.subtype ?? null,
              available: a.balances.available ?? null,
              limit: a.balances.limit ?? null,
              currency: a.balances.iso_currency_code ?? null,
            }),
          );
        }
      }
      if (accts.length) {
        // Accounts closed at the institution stop being listed (their history stays in events).
        await tx.delete(accounts).where(and(eq(accounts.itemId, itemId), notInArray(accounts.plaidAccountId, accts.map((a) => a.account_id))));
      }
      await upsertEvents(tx, rows);
      for (let i = 0; i < removed.length; i += 500) {
        await tx.delete(events).where(and(eq(events.source, PLAID), ofItem(itemId), inArray(events.sourceId, removed.slice(i, i + 500))));
      }
      if (holdingKeep) {
        // Today's snapshot should match the account now, so a position sold today disappears.
        await tx.delete(events).where(
          and(
            eq(events.source, PLAID),
            eq(events.key, "finance.holding"),
            eq(events.ts, todayTs),
            ofItem(itemId),
            holdingKeep.length ? notInArray(events.sourceId, holdingKeep) : undefined,
          ),
        );
      }
      if (invKeep) {
        // Cancelled or corrected investment activity drops out. An empty answer for an account that
        // had history is more likely a bad response than a wiped history, so it is kept.
        const inWindow = and(eq(events.source, PLAID), eq(events.key, "finance.investment_transaction"), ofItem(itemId), gte(events.ts, invWindowStart));
        const [stored] = await tx.select({ n: count() }).from(events).where(inWindow);
        if (invKeep.length > 0 || (stored?.n ?? 0) <= 3) {
          await tx.delete(events).where(and(inWindow, invKeep.length ? notInArray(events.sourceId, invKeep) : undefined));
        }
      }
      const status = opts.repaired ? "ok" : item.status;
      await tx
        .update(plaidItems)
        .set({
          cursor,
          institutionName: name,
          institutionId,
          status,
          lastError: opts.repaired ? null : item.status === "login_required" ? item.lastError : null,
          lastSyncedAt: new Date(),
        })
        .where(eq(plaidItems.id, itemId));
      return true;
    });
    return wrote ? "synced" : "missing";
  } catch (e) {
    const login = e instanceof PlaidError && e.code === "ITEM_LOGIN_REQUIRED";
    console.error("plaid: sync failed", describeError(e));
    await db()
      .update(plaidItems)
      .set(login ? { status: "login_required", lastError: REAUTH } : { lastError: "Sync failed. It will retry." })
      .where(eq(plaidItems.id, itemId))
      .catch(() => {});
    throw e;
  } finally {
    await release(itemId);
  }
}

export async function syncAllItems(): Promise<{ synced: number; failed: number; deferred: number }> {
  const started = Date.now();
  let synced = 0;
  let failed = 0;
  let deferred = 0;
  for (const item of await listItems()) {
    if (Date.now() - started > BUDGET_MS) {
      deferred++; // out of time; webhooks or the next run pick it up
      continue;
    }
    try {
      if ((await syncItem(item.id)) === "synced") synced++;
    } catch {
      failed++;
    }
  }
  return { synced, failed, deferred };
}
