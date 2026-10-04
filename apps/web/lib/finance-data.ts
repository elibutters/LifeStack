import "server-only";
import { and, eq, gte } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { accounts, events } from "@lifestack/db";
import { db } from "./db";
import { addDays, startOfDay, ymd } from "./dates";
import { describeError } from "./errors";
import type { AccountInfo, Liability, Txn } from "./finance-calc";

// Reads the synced finance data and shapes it for the calculations in finance-calc.ts.
export const todayDay = () => ymd(new Date());

const TxnPayload = z.object({
  accountId: z.string(),
  name: z.string(),
  merchant: z.string().nullish(),
  pending: z.boolean().nullish(),
  category: z.string().nullish(),
  categoryDetailed: z.string().nullish(),
});

export async function loadAccounts(): Promise<AccountInfo[]> {
  const rows = await db()
    .select({
      id: accounts.id,
      plaidAccountId: accounts.plaidAccountId,
      name: accounts.name,
      nickname: sql<string | null>`"nickname"`,
      institution: accounts.institution,
      type: accounts.type,
      subtype: accounts.subtype,
      currentBalance: accounts.currentBalance,
      availableBalance: accounts.availableBalance,
      creditLimit: accounts.creditLimit,
      balanceAt: accounts.balanceAt,
    })
    .from(accounts)
    .orderBy(accounts.institution, accounts.type, accounts.name);
  return rows.map((r) => ({
    id: r.id,
    plaidAccountId: r.plaidAccountId ?? String(r.id),
    name: r.name,
    nickname: r.nickname,
    institution: r.institution,
    type: r.type ?? "other",
    subtype: r.subtype,
    current: r.currentBalance,
    available: r.availableBalance,
    limit: r.creditLimit,
    balanceAt: r.balanceAt,
  }));
}

export async function loadTransactions(days = 430): Promise<Txn[]> {
  const since = startOfDay(addDays(todayDay(), -days));
  const rows = await db()
    .select()
    .from(events)
    .where(and(eq(events.source, "plaid"), eq(events.key, "finance.transaction"), gte(events.ts, since)))
    .orderBy(events.ts);
  const out: Txn[] = [];
  let unreadable = 0;
  for (const r of rows) {
    const p = TxnPayload.safeParse(r.payload);
    if (!p.success || r.valueNum == null) {
      unreadable++;
      continue;
    }
    out.push({
      id: r.sourceId ?? String(r.id),
      date: ymd(r.ts),
      amount: r.valueNum,
      name: p.data.name,
      merchant: p.data.merchant ?? null,
      category: p.data.category ?? null,
      detailed: p.data.categoryDetailed ?? null,
      pending: !!p.data.pending,
      accountId: p.data.accountId,
    });
  }
  if (unreadable) console.error(`finance: ${unreadable} transaction row(s) could not be read`); // counts only, never contents
  return out;
}

type Row = Record<string, unknown>;
const rowsOf = async (q: ReturnType<typeof sql>) => (await db().execute(q)) as unknown as Row[];
const str = (v: unknown) => (typeof v === "string" ? v : null);
const numOrNull = (v: unknown) => (typeof v === "number" ? v : null);

export async function loadLiabilities(): Promise<Liability[]> {
  const rows = await rowsOf(sql`
    select distinct on (payload->>'accountId') payload, value_num
    from events where source = 'plaid' and key = 'finance.liability'
    order by payload->>'accountId', ts desc`);
  return rows.map((r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    return {
      accountId: String(p.accountId ?? ""),
      minimumPayment: numOrNull(p.minimumPayment),
      nextPaymentDue: str(p.nextPaymentDue),
      lastStatementBalance: numOrNull(r.value_num),
      isOverdue: typeof p.isOverdue === "boolean" ? p.isOverdue : null,
    };
  });
}

export type Holding = {
  accountId: string;
  symbol: string | null;
  name: string | null;
  securityType: string | null;
  quantity: number;
  price: number;
  value: number;
  costBasis: number | null;
};

// The newest snapshot for each account; a position sold in an earlier snapshot is not listed.
export async function loadHoldings(): Promise<Holding[]> {
  const rows = await rowsOf(sql`
    select payload, value_num, ts
    from events where source = 'plaid' and key = 'finance.holding'
      and ts = (select max(e2.ts) from events e2 where e2.source = 'plaid' and e2.key = 'finance.holding'
                and e2.payload->>'accountId' = events.payload->>'accountId')
    order by value_num desc`);
  return rows.map((r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    return {
      accountId: String(p.accountId ?? ""),
      symbol: str(p.symbol),
      name: str(p.name),
      securityType: str(p.securityType),
      quantity: numOrNull(p.quantity) ?? 0,
      price: numOrNull(p.price) ?? 0,
      value: numOrNull(r.value_num) ?? 0,
      costBasis: numOrNull(p.costBasis),
    };
  });
}

export async function loadBalanceSnapshots(days = 400) {
  const since = startOfDay(addDays(todayDay(), -days));
  const rows = await db()
    .select()
    .from(events)
    .where(and(eq(events.source, "plaid"), eq(events.key, "finance.balance"), gte(events.ts, since)))
    .orderBy(events.ts);
  return rows.flatMap((r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    return r.valueNum == null ? [] : [{ accountId: String(p.accountId ?? ""), day: ymd(r.ts), value: r.valueNum, type: String(p.accountType ?? "depository") }];
  });
}

export async function loadFinance() {
  try {
    const [accts, txns, liabilities] = await Promise.all([loadAccounts(), loadTransactions(), loadLiabilities()]);
    return { ok: true as const, accounts: accts, txns, liabilities, today: todayDay() };
  } catch (e) {
    console.error("finance: could not load", describeError(e));
    return { ok: false as const };
  }
}
