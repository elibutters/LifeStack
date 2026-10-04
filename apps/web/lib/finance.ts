import "server-only";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { accounts, events, plaidItems, type Db } from "@lifestack/db";
import { decrypt, encrypt } from "./crypto";
import { db } from "./db";
import { addDays, startOfDay, ymd } from "./dates";
import {
  accountsGet,
  creditLiabilitiesGet,
  holdingsGet,
  institutionOf,
  investmentTransactionsGetAll,
  itemRemove,
  PlaidError,
  publicTokenExchange,
  transactionsSyncAll,
  type PlaidKind,
} from "./plaid";

// Finance data lives in the shared `events` table (domain "finance", source "plaid"), so it can be
// joined with everything else. Every payload carries `itemId` so an unlink can remove it all.
//   finance.transaction             value = amount (Plaid's sign: positive is money out), ts = date
//   finance.balance                 value = current balance, one row per account per day
//   finance.holding                 value = market value, one row per position per day
//   finance.investment_transaction  value = amount, ts = date
//   finance.liability               value = last statement balance, credit cards, one row per day
// source_id is unique per source across all kinds, so snapshots are prefixed: bal:, liab:, hold:, inv:
// (transactions keep Plaid's own transaction_id).
// Account numbers are never stored; accounts keep a name, type and balances only.
const PLAID = "plaid";
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type EventRow = typeof events.$inferInsert;

const IGNORABLE_LIABILITY_ERRORS = new Set(["PRODUCTS_NOT_SUPPORTED", "NO_LIABILITY_ACCOUNTS", "PRODUCT_NOT_READY", "ADDITIONAL_CONSENT_REQUIRED"]);
const REAUTH = "Sign in again at this institution to keep syncing.";

export async function listItems() {
  return db().select().from(plaidItems).orderBy(plaidItems.createdAt);
}

export async function linkItem(kind: PlaidKind, publicToken: string): Promise<string> {
  const { access_token, item_id } = await publicTokenExchange(publicToken);
  const inst = await institutionOf(access_token);
  await db()
    .insert(plaidItems)
    .values({ id: item_id, kind, institutionId: inst.id, institutionName: inst.name, accessTokenEnc: encrypt(access_token) })
    .onConflictDoUpdate({ target: plaidItems.id, set: { accessTokenEnc: encrypt(access_token), status: "ok", lastError: null } });
  return item_id;
}

export async function accessTokenFor(itemId: string): Promise<string | null> {
  const [item] = await db().select({ enc: plaidItems.accessTokenEnc }).from(plaidItems).where(eq(plaidItems.id, itemId));
  return item ? decrypt(item.enc) : null;
}

export async function unlinkItem(itemId: string) {
  const [item] = await db().select().from(plaidItems).where(eq(plaidItems.id, itemId));
  if (!item) return;
  try {
    await itemRemove(decrypt(item.accessTokenEnc)); // revokes access at Plaid and stops billing
  } catch (e) {
    console.error("plaid: item/remove failed", e instanceof PlaidError ? e.code : "unknown error");
  }
  await db().transaction(async (tx) => {
    await tx.delete(events).where(and(eq(events.source, PLAID), sql`${events.payload}->>'itemId' = ${itemId}`));
    await tx.delete(plaidItems).where(eq(plaidItems.id, itemId)); // accounts go with it
  });
}

export async function markNeedsLogin(itemId: string) {
  await db().update(plaidItems).set({ status: "login_required", lastError: REAUTH }).where(eq(plaidItems.id, itemId));
}

async function claim(itemId: string): Promise<boolean> {
  const got = await db()
    .update(plaidItems)
    .set({ leaseUntil: sql`now() + interval '10 minutes'` })
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
  for (let i = 0; i < rows.length; i += 500) {
    await tx
      .insert(events)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [events.source, events.sourceId],
        set: { ts: sql`excluded.ts`, valueNum: sql`excluded.value_num`, payload: sql`excluded.payload` },
      });
  }
}

export type SyncOutcome = "synced" | "skipped" | "missing" | "not_ready";

// Reads everything from Plaid first, then writes it in one transaction together with the new sync
// position, so a failed or partial sync never leaves half the data or skips transactions.
export async function syncItem(itemId: string): Promise<SyncOutcome> {
  const [item] = await db().select().from(plaidItems).where(eq(plaidItems.id, itemId));
  if (!item) return "missing";
  if (!(await claim(itemId))) return "skipped";
  try {
    const token = decrypt(item.accessTokenEnc);
    const today = ymd(new Date());
    const todayTs = startOfDay(today);
    const rows: EventRow[] = [];
    const removed: string[] = [];
    let cursor = item.cursor;
    let staleHoldingGuard: { accountIds: string[]; keep: string[] } | null = null;
    const ev = (key: string, ts: Date, value: number | null, sourceId: string, payload: Record<string, unknown>): EventRow => ({
      ts,
      domain: "finance",
      key,
      valueNum: value,
      payload: { itemId, ...payload },
      source: PLAID,
      sourceId,
    });

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
        try {
          for (const c of await creditLiabilitiesGet(token)) {
            if (!c.account_id) continue;
            rows.push(
              ev("finance.liability", todayTs, c.last_statement_balance ?? null, `liab:${c.account_id}:${today}`, {
                accountId: c.account_id,
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
          if (!(e instanceof PlaidError && IGNORABLE_LIABILITY_ERRORS.has(e.code))) throw e;
        }
      } else {
        const h = await holdingsGet(token);
        const sec = new Map(h.securities.map((s) => [s.security_id, s]));
        const keep: string[] = [];
        for (const p of h.holdings) {
          const s = sec.get(p.security_id);
          const sourceId = `hold:${p.account_id}:${p.security_id}:${today}`;
          keep.push(sourceId);
          rows.push(
            ev("finance.holding", todayTs, p.institution_value, sourceId, {
              accountId: p.account_id,
              symbol: s?.ticker_symbol ?? null,
              name: s?.name ?? null,
              securityType: s?.type ?? null,
              quantity: p.quantity,
              price: p.institution_price,
              costBasis: p.cost_basis ?? null,
              currency: p.iso_currency_code ?? null,
            }),
          );
        }
        staleHoldingGuard = { accountIds: accts.map((a) => a.account_id), keep };
        const it = await investmentTransactionsGetAll(token, addDays(today, -730), today);
        const isec = new Map(it.securities.map((s) => [s.security_id, s]));
        for (const t of it.transactions) {
          const s = t.security_id ? isec.get(t.security_id) : undefined;
          rows.push(
            ev("finance.investment_transaction", startOfDay(t.date), t.amount, `inv:${t.investment_transaction_id}`, {
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
      }
    } catch (e) {
      if (e instanceof PlaidError && e.code === "PRODUCT_NOT_READY") return "not_ready"; // webhook will call back
      throw e;
    }

    const wrote = await db().transaction(async (tx) => {
      const [live] = await tx.select({ id: plaidItems.id }).from(plaidItems).where(eq(plaidItems.id, itemId)).for("share");
      if (!live) return false; // unlinked while we were running

      for (const a of accts) {
        const values = {
          name: a.name,
          institution: item.institutionName,
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
              available: a.balances.available ?? null,
              limit: a.balances.limit ?? null,
              currency: a.balances.iso_currency_code ?? null,
            }),
          );
        }
      }
      await upsertEvents(tx, rows);
      for (let i = 0; i < removed.length; i += 500) {
        await tx.delete(events).where(and(eq(events.source, PLAID), inArray(events.sourceId, removed.slice(i, i + 500))));
      }
      if (staleHoldingGuard) {
        // Today's snapshot should match the account now, so a position sold today disappears.
        await tx.delete(events).where(
          and(
            eq(events.source, PLAID),
            eq(events.key, "finance.holding"),
            eq(events.ts, todayTs),
            sql`${events.payload}->>'itemId' = ${itemId}`,
            staleHoldingGuard.keep.length ? notInArray(events.sourceId, staleHoldingGuard.keep) : undefined,
          ),
        );
      }
      await tx.update(plaidItems).set({ cursor, status: "ok", lastError: null, lastSyncedAt: new Date() }).where(eq(plaidItems.id, itemId));
      return true;
    });
    return wrote ? "synced" : "missing";
  } catch (e) {
    const login = e instanceof PlaidError && e.code === "ITEM_LOGIN_REQUIRED";
    console.error("plaid: sync failed", e instanceof PlaidError ? e.code : e instanceof Error ? e.message : "unknown error");
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

export async function syncAllItems(): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;
  for (const item of await listItems()) {
    try {
      if ((await syncItem(item.id)) === "synced") synced++;
    } catch {
      failed++;
    }
  }
  return { synced, failed };
}
