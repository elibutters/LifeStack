import { and, eq, sql } from "drizzle-orm";
import { accounts, createDb, events, plaidItems } from "./index";

// Development only: fills a LOCAL database with obviously fake finance data (a year of invented
// transactions, balances, holdings and a card bill) so the Finance pages have something to show.
// Refuses to touch any hosted database. Everything is generated from a fixed seed, so it is repeatable.
const url = process.env.DATABASE_URL ?? "";
let host = "";
try {
  host = new URL(url).hostname;
} catch {}
if (!["127.0.0.1", "localhost"].includes(host)) {
  console.error("seed-finance: refusing to run against a hosted database");
  process.exit(1);
}

let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const between = (a: number, b: number) => Math.round((a + rand() * (b - a)) * 100) / 100;
const DAY = 86_400_000;
const now = new Date();
const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
const dayStr = (n: number) => new Date(n).toISOString().slice(0, 10);

const { db, client } = createDb(url, 1);
const ITEM = "item-fake-1";
await db.delete(events).where(and(eq(events.source, "plaid"), sql`${events.payload} @> ${JSON.stringify({ itemId: ITEM })}::jsonb`));
await db.delete(plaidItems).where(eq(plaidItems.id, ITEM));
await db.insert(plaidItems).values({ id: ITEM, kind: "bank", env: "sandbox", institutionName: "Example Bank", accessTokenEnc: "not-a-token", lastSyncedAt: new Date() });

const acct = (id: string, name: string, type: string, subtype: string, cur: number, limit: number | null = null) => ({ id, name, type, subtype, cur, limit });
const list = [
  acct("fk_chk", "Everyday Checking", "depository", "checking", 4820.55),
  acct("fk_sav", "High-Yield Savings", "depository", "savings", 18250),
  acct("fk_cc", "Rewards Card", "credit", "credit card", 1264.3, 8000),
  acct("fk_brk", "Brokerage", "investment", "brokerage", 41230.12),
  acct("fk_roth", "Roth IRA", "investment", "roth", 23890.4),
];
for (const a of list) {
  await db.insert(accounts).values({ name: a.name, institution: "Example Bank", type: a.type, subtype: a.subtype, itemId: ITEM, plaidAccountId: a.id, currentBalance: a.cur, creditLimit: a.limit, balanceAt: new Date() }).onConflictDoUpdate({ target: accounts.plaidAccountId, set: { currentBalance: a.cur, name: a.name } });
}

type Row = typeof events.$inferInsert;
const rows: Row[] = [];
let n = 0;
const add = (date: string, amount: number, name: string, category: string, account: string, extra: Record<string, unknown> = {}) =>
  rows.push({ ts: new Date(`${date}T00:00:00Z`), domain: "finance", key: "finance.transaction", valueNum: amount, source: "plaid", sourceId: `fk-${++n}`, payload: { itemId: ITEM, accountId: account, name, merchant: name, pending: false, category, categoryDetailed: null, ...extra } });

const merchants: [string, string, number, number][] = [
  ["Example Coffee", "FOOD_AND_DRINK", 4, 9], ["Corner Grocery", "FOOD_AND_DRINK", 22, 120], ["Pizza Place", "FOOD_AND_DRINK", 14, 48], ["Fuel Stop", "TRANSPORTATION", 28, 62],
  ["Ride Share", "TRANSPORTATION", 9, 34], ["Big Box Store", "GENERAL_MERCHANDISE", 18, 210], ["Online Shop", "GENERAL_MERCHANDISE", 12, 140], ["Cinema", "ENTERTAINMENT", 12, 38],
  ["Pharmacy", "MEDICAL", 8, 45], ["Salon", "PERSONAL_CARE", 30, 90],
];
for (let d = 400; d >= 0; d--) {
  const t = today - d * DAY; const date = dayStr(t); const dom = new Date(t).getUTCDate();
  if (dom === 1) add(date, 1850, "Example Landlord", "RENT_AND_UTILITIES", "fk_chk", { detailed: "RENT_AND_UTILITIES_RENT" });
  if (dom === 5) add(date, between(70, 130), "Power Company", "RENT_AND_UTILITIES", "fk_chk");
  if (dom === 1 || dom === 15) add(date, -3100, "Employer Payroll", "INCOME", "fk_chk");
  if (dom === 3) add(date, 15.49, "Streamify", "ENTERTAINMENT", "fk_cc");
  if (dom === 9) add(date, 2.99, "Cloud Storage", "GENERAL_SERVICES", "fk_cc");
  if (dom === 12) add(date, 45, "Neighborhood Gym", "PERSONAL_CARE", "fk_cc");
  if (dom === 20) { add(date, 1200, "Move to savings", "TRANSFER_OUT", "fk_chk"); add(date, -1200, "From checking", "TRANSFER_IN", "fk_sav"); }
  if (dom === 25) { add(date, 1500, "Card payment", "LOAN_PAYMENTS", "fk_chk", { categoryDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }); add(date, -1500, "Payment received", "LOAN_PAYMENTS", "fk_cc", { categoryDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }); }
  for (let k = 0; k < 2; k++) if (rand() < 0.55) { const m = merchants[Math.floor(rand() * merchants.length)]!; add(date, between(m[2], m[3]), m[0], m[1], rand() < 0.6 ? "fk_cc" : "fk_chk"); }
  if (rand() < 0.012) add(date, between(300, 900), "Airline Tickets", "TRAVEL", "fk_cc");
  if (d === 0) add(date, 6.25, "Example Coffee", "FOOD_AND_DRINK", "fk_chk", { pending: true });
}
const todayStr = dayStr(today);
for (const a of list) {
  rows.push({ ts: new Date(`${todayStr}T00:00:00Z`), domain: "finance", key: "finance.balance", valueNum: a.cur, source: "plaid", sourceId: `fk-bal-${a.id}`, payload: { itemId: ITEM, accountId: a.id, accountType: a.type, subtype: a.subtype } });
}
rows.push({ ts: new Date(`${todayStr}T00:00:00Z`), domain: "finance", key: "finance.liability", valueNum: 1180.2, source: "plaid", sourceId: "fk-liab-1", payload: { itemId: ITEM, accountId: "fk_cc", accountType: "credit", minimumPayment: 35, nextPaymentDue: dayStr(today + 6 * DAY), isOverdue: false } });
const holdings: [string, string, string, string, number, number, number | null][] = [
  ["fk_brk", "EXF", "Example Total Market Fund", "etf", 120.5, 148.2, 11200], ["fk_brk", "OTH", "Other Co", "equity", 40, 312.75, 9100], ["fk_brk", "BND", "Example Bond Fund", "etf", 90, 72.4, 6900], ["fk_brk", "CASH", "Cash", "cash", 1, 3500, null],
  ["fk_roth", "EXF", "Example Total Market Fund", "etf", 98, 148.2, 12400], ["fk_roth", "INTL", "Example International Fund", "mutual fund", 210, 41.8, 7600],
];
for (const [acc, sym, name, type, qty, price, cost] of holdings) {
  rows.push({ ts: new Date(`${todayStr}T00:00:00Z`), domain: "finance", key: "finance.holding", valueNum: Math.round(qty * price * 100) / 100, source: "plaid", sourceId: `fk-h-${acc}-${sym}`, payload: { itemId: ITEM, accountId: acc, symbol: sym, name, securityType: type, quantity: qty, price, costBasis: cost } });
}
for (let i = 0; i < rows.length; i += 500) await db.insert(events).values(rows.slice(i, i + 500)).onConflictDoNothing();
await client.end();
console.log(`seeded ${rows.length} fake finance rows`);
