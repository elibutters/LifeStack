// Finance data loaders against the throwaway database. Run with `pnpm test`.
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
process.env.APP_TZ = "UTC";
const data = await import("../lib/finance-data.ts"); const { db } = await import("../lib/db.ts");
const { events, accounts, plaidItems, txnOverrides } = await import("@lifestack/db");

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const ts = (d: string) => new Date(`${d}T00:00:00Z`);
let n = 0;
const ev = (key: string, d: string, value: number | null, payload: Record<string, unknown>) => ({ ts: ts(d), domain: "finance", key, valueNum: value, source: "plaid", sourceId: `t-${++n}`, payload: { itemId: "item-t", ...payload } });

await db().delete(events); await db().delete(plaidItems);
await db().insert(plaidItems).values({ id: "item-t", kind: "bank", env: "sandbox", institutionName: "Example Bank", accessTokenEnc: "x" });
await db().insert(accounts).values([
  { name: "Checking", institution: "Example Bank", type: "depository", subtype: "checking", itemId: "item-t", plaidAccountId: "chk", currentBalance: 100.5, availableBalance: 90 },
  { name: "Card", institution: "Example Bank", type: "credit", subtype: "credit card", itemId: "item-t", plaidAccountId: "cc", currentBalance: 40, creditLimit: 1000 },
  { name: "Brokerage", institution: "Example Bank", type: "investment", subtype: "brokerage", itemId: "item-t", plaidAccountId: "brk", currentBalance: 5000 },
]);

await db().insert(events).values([
  ev("finance.transaction", day(1), 12.34, { accountId: "chk", name: "Coffee", merchant: "Example Coffee", pending: false, category: "FOOD_AND_DRINK", categoryDetailed: "FOOD_AND_DRINK_COFFEE" }),
  ev("finance.transaction", day(2), -2000, { accountId: "chk", name: "Payroll", merchant: null, pending: false, category: "INCOME" }),
  ev("finance.transaction", day(0), 5, { accountId: "cc", name: "Pending thing", pending: true, category: null }),
  ev("finance.transaction", day(3), 9, { accountId: "chk" }),                         // unreadable: no name
  ev("finance.transaction", day(3), null, { accountId: "chk", name: "No amount" }),   // unreadable: no value
  ev("finance.transaction", day(900), 7, { accountId: "chk", name: "Too old" }),      // outside the window
  ev("finance.liability", day(3), 100, { accountId: "cc", nextPaymentDue: day(-20), minimumPayment: 25 }),
  ev("finance.liability", day(0), 120, { accountId: "cc", nextPaymentDue: day(-9), minimumPayment: 35, isOverdue: false }),
  ev("finance.holding", day(1), 700, { accountId: "brk", symbol: "OLD", name: "Sold since", securityType: "equity", quantity: 7, price: 100, costBasis: 500 }),
  ev("finance.holding", day(0), 1500, { accountId: "brk", symbol: "EXF", name: "Example Fund", securityType: "etf", quantity: 10, price: 150, costBasis: 1000 }),
  ev("finance.holding", day(5), 300, { accountId: "other", symbol: "ONLY", name: "Only snapshot", securityType: "equity", quantity: 3, price: 100, costBasis: null }),
  ev("finance.balance", day(1), 90, { accountId: "chk", accountType: "depository" }),
  ev("finance.balance", day(0), 100.5, { accountId: "chk", accountType: "depository" }),
  ev("finance.balance", day(0), 40, { accountId: "cc", accountType: "credit" }),
]);

const accts = await data.loadAccounts();
assert.deepEqual(accts.map((a: any) => a.name).sort(), ["Brokerage", "Card", "Checking"]);
const chk = accts.find((a: any) => a.plaidAccountId === "chk")!; assert.equal(chk.current, 100.5); assert.equal(chk.available, 90); assert.equal(chk.type, "depository");
assert.equal(accts.find((a: any) => a.plaidAccountId === "cc")!.limit, 1000);

const logs: string[] = []; const orig = console.error; console.error = (...a: unknown[]) => logs.push(a.join(" "));
const txns = await data.loadTransactions(); console.error = orig;
assert.equal(txns.length, 3, "unreadable and out-of-window rows are left out");
const coffee = txns.find((t: any) => t.name === "Coffee")!; assert.equal(coffee.date, day(1)); assert.equal(coffee.amount, 12.34); assert.equal(coffee.merchant, "Example Coffee"); assert.equal(coffee.category, "FOOD_AND_DRINK"); assert.equal(coffee.detailed, "FOOD_AND_DRINK_COFFEE"); assert.equal(coffee.pending, false); assert.equal(coffee.accountId, "chk");
await db().insert(txnOverrides).values({ sourceId: coffee.id, category: "RENT" });
assert.equal((await data.loadTransactions()).find((t: { name: string }) => t.name === "Coffee")!.category, "RENT");
await db().delete(txnOverrides);
assert.equal(txns.find((t: any) => t.name === "Pending thing")!.pending, true); assert.equal(txns.find((t: any) => t.name === "Payroll")!.merchant, null);
assert.ok(logs.some((l) => /2 transaction row\(s\) could not be read/.test(l)) && !logs.join(" ").match(/Coffee|Payroll|12\.34/), "the log reports a count, never contents");
assert.deepEqual(txns.map((t: any) => t.date), [...txns.map((t: any) => t.date)].sort(), "oldest first");

const liab = await data.loadLiabilities(); assert.equal(liab.length, 1); assert.equal(liab[0]!.minimumPayment, 35); assert.equal(liab[0]!.lastStatementBalance, 120); assert.equal(liab[0]!.nextPaymentDue, day(-9)); assert.equal(liab[0]!.isOverdue, false);

const holds = await data.loadHoldings(); const syms = holds.map((h: any) => h.symbol).sort();
assert.deepEqual(syms, ["EXF", "ONLY"], "an account shows its newest snapshot only; a position sold since is gone");
const exf = holds.find((h: any) => h.symbol === "EXF")!; assert.equal(exf.value, 1500); assert.equal(exf.quantity, 10); assert.equal(exf.costBasis, 1000); assert.equal(exf.securityType, "etf");
assert.equal(holds.find((h: any) => h.symbol === "ONLY")!.costBasis, null);

const snaps = await data.loadBalanceSnapshots(); assert.equal(snaps.length, 3); assert.ok(snaps.every((s: any) => /^\d{4}-\d{2}-\d{2}$/.test(s.day)));
assert.equal(snaps.find((s: any) => s.accountId === "cc")!.type, "credit");

const all = await data.loadFinance(); assert.equal(all.ok, true); if (all.ok) { assert.equal(all.accounts.length, 3); assert.equal(all.txns.length, 3); assert.equal(all.today, day(0)); }

await db().delete(events); await db().delete(plaidItems);
console.log("FINANCE DATA OK"); process.exit(0);
