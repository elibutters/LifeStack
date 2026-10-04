// Pure finance maths. No database needed. Run with `pnpm test`.
import assert from "node:assert/strict";
import * as c from "../lib/finance-calc.ts";

let n = 0;
const T = (date: string, amount: number, name: string, category: string | null, extra: Partial<c.Txn> = {}): c.Txn =>
  ({ id: `t${++n}`, date, amount, name, merchant: null, category, detailed: null, pending: false, accountId: "chk", ...extra });
const acct = (type: string, current: number | null, extra: Partial<c.AccountInfo> = {}): c.AccountInfo =>
  ({ id: ++n, plaidAccountId: `a${n}`, name: `${type} ${n}`, institution: "Example", type, subtype: null, current, available: null, limit: null, balanceAt: null, ...extra });

// ---- classification
assert.equal(c.classify({ amount: 50, category: "FOOD_AND_DRINK", detailed: null }), "spending");
assert.equal(c.classify({ amount: -2000, category: "INCOME", detailed: null }), "income");
assert.equal(c.classify({ amount: -20, category: "FOOD_AND_DRINK", detailed: null }), "spending");   // a refund nets against spending
assert.equal(c.classify({ amount: 500, category: "TRANSFER_OUT", detailed: null }), "transfer");
assert.equal(c.classify({ amount: -500, category: "TRANSFER_IN", detailed: null }), "transfer");
assert.equal(c.classify({ amount: 300, category: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }), "transfer");   // paying the card is not spending
assert.equal(c.classify({ amount: 900, category: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" }), "spending");   // a mortgage payment is
assert.equal(c.categoryLabel("FOOD_AND_DRINK"), "Food and drink"); assert.equal(c.categoryLabel("SOMETHING_NEW"), "Something new"); assert.equal(c.categoryLabel(null), "Uncategorized");

// ---- months
assert.equal(c.shiftMonthKey("2026-01", -1), "2025-12"); assert.equal(c.shiftMonthKey("2026-12", 1), "2027-01");
assert.deepEqual(c.lastMonths("2026-02", 4), ["2025-11", "2025-12", "2026-01", "2026-02"]);

// ---- a month of activity
const tx = [
  T("2026-09-01", -3000, "Employer payroll", "INCOME"),
  T("2026-09-02", 1500, "Landlord", "RENT_AND_UTILITIES"),
  T("2026-09-05", 40, "Coffee Co", "FOOD_AND_DRINK", { merchant: "Coffee Co" }),
  T("2026-09-12", 60, "Coffee Co", "FOOD_AND_DRINK", { merchant: "Coffee Co" }),
  T("2026-09-12", -15, "Coffee Co refund", "FOOD_AND_DRINK"),
  T("2026-09-15", 800, "Move to savings", "TRANSFER_OUT"),
  T("2026-09-15", -800, "From checking", "TRANSFER_IN", { accountId: "sav" }),
  T("2026-09-20", 250, "Card payment", "LOAN_PAYMENTS", { detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }),
  T("2026-09-21", 100, "Gas Station", "TRANSPORTATION"),
  T("2026-09-22", 9, "Pending thing", "ENTERTAINMENT", { pending: true }),
  T("2026-08-30", 70, "Last month", "FOOD_AND_DRINK"),
];
const s = c.summarizeMonth(tx, "2026-09");
assert.equal(s.income, 3000); assert.equal(s.spending, 1500 + 40 + 60 - 15 + 100 + 9); assert.equal(s.net, 3000 - s.spending);
assert.equal(s.byCategory[0]!.label, "Rent and utilities"); assert.equal(s.byCategory[0]!.amount, 1500);
const food = s.byCategory.find((x) => x.category === "FOOD_AND_DRINK")!; assert.equal(food.amount, 85); assert.equal(food.count, 3);
assert.ok(!s.byCategory.some((x) => x.category?.startsWith("TRANSFER") || x.category === "LOAN_PAYMENTS" || x.category === "INCOME"));
assert.equal(s.topMerchants[0]!.name, "Landlord"); assert.equal(s.topMerchants.find((m) => m.name === "Coffee Co")!.amount, 100);
assert.ok(Math.abs(s.savingsRate! - (3000 - s.spending) / 3000) < 1e-9);
assert.equal(c.summarizeMonth(tx, "2026-01").savingsRate, null);
assert.deepEqual(c.cashflowSeries(tx, ["2026-08", "2026-09"]).map((m) => [m.income, m.spending]), [[0, 70], [3000, s.spending]]);

// ---- net worth
const nw = c.netWorth([acct("depository", 1000), acct("depository", 5000), acct("credit", 300), acct("investment", 20000), acct("loan", 10000), acct("depository", null)]);
assert.equal(nw.assets, 26000); assert.equal(nw.liabilities, 10300); assert.equal(nw.net, 15700);
assert.deepEqual(nw.groups.map((g) => [g.key, g.total]), [["cash", 6000], ["credit", 300], ["investments", 20000], ["loans", 10000]]);

// ---- cash position rebuilt from today's balances
const chk = acct("depository", 1000, { plaidAccountId: "chk" }); const card = acct("credit", 300, { plaidAccountId: "card" });
const hist = c.cashPositionHistory([chk, card], [
  T("2026-10-03", 100, "Spent", "FOOD_AND_DRINK", { accountId: "chk" }),
  T("2026-10-01", -500, "Paid", "INCOME", { accountId: "chk" }),
  T("2026-10-03", 50, "Charged", "FOOD_AND_DRINK", { accountId: "card" }),
  T("2026-10-01", -100, "Card payment", "LOAN_PAYMENTS", { accountId: "card" }),
  T("2026-10-02", 999, "Still pending", "FOOD_AND_DRINK", { accountId: "chk", pending: true }),
], "2026-10-04", 5);
const at = (d: string) => hist.find((p) => p.day === d)!.value;
assert.equal(hist.length, 6); assert.equal(hist[0]!.day, "2026-09-29"); assert.equal(hist.at(-1)!.day, "2026-10-04");
assert.equal(at("2026-10-04"), 1000 - 300);          // today: cash minus card debt
assert.equal(at("2026-10-03"), 1000 - 300);          // end of the 3rd: the day's own spending is already in the balance
assert.equal(at("2026-10-02"), 1100 - 250);          // before the 3rd: cash was 100 higher and the card debt 50 lower
assert.equal(at("2026-10-01"), 1100 - 250);
assert.equal(at("2026-09-30"), 600 - 350);           // before the 1st: the 500 paycheck and the 100 card payment had not happened
assert.deepEqual(c.cashPositionHistory([acct("investment", 5)], [], "2026-10-04", 3), []);

// ---- stored snapshots, carried forward
const snaps = c.snapshotNetWorth([
  { accountId: "a", day: "2026-10-01", value: 100, type: "depository" }, { accountId: "b", day: "2026-10-01", value: 40, type: "credit" },
  { accountId: "a", day: "2026-10-03", value: 130, type: "depository" },
]);
assert.deepEqual(snaps, [{ day: "2026-10-01", value: 60 }, { day: "2026-10-02", value: 60 }, { day: "2026-10-03", value: 90 }]);
assert.deepEqual(c.snapshotNetWorth([]), []);

// ---- recurring charges
const monthly = (name: string, amt: (i: number) => number, start: string, count: number, cat = "ENTERTAINMENT") =>
  Array.from({ length: count }, (_, i) => { const d = new Date(Date.parse(start + "T00:00:00Z") + i * 30.4 * 86_400_000); return T(d.toISOString().slice(0, 10), amt(i), name, cat, { merchant: name }); });
const rec = c.detectRecurring([
  ...monthly("Streamify", () => 15.49, "2026-04-03", 6),                       // steady monthly
  ...monthly("Power Company", (i) => 80 + i * 8, "2026-04-10", 6, "RENT_AND_UTILITIES"),   // varies but stays within range
  ...monthly("Old Gym", () => 40, "2026-01-05", 4),                            // stopped months ago
  ...monthly("Twice Only", () => 9, "2026-08-01", 2),
  T("2026-09-01", 33, "Grocery Store", "FOOD_AND_DRINK"), T("2026-09-03", 51, "Grocery Store", "FOOD_AND_DRINK"), T("2026-09-11", 12, "Grocery Store", "FOOD_AND_DRINK"), T("2026-09-30", 78, "Grocery Store", "FOOD_AND_DRINK"),
  T("2026-09-05", 15.49, "Streamify", "ENTERTAINMENT", { merchant: "Streamify" }),       // a second charge the same stretch
  ...Array.from({ length: 6 }, (_, i) => T(`2026-0${4 + Math.floor(i / 2)}-${i % 2 ? "20" : "05"}`, -3000, "Employer payroll", "INCOME")),   // income is never a subscription
], "2026-10-04");
const names = rec.map((r) => r.name);
assert.ok(names.includes("Streamify")); assert.ok(names.includes("Power Company"));
assert.ok(!names.includes("Old Gym")); assert.ok(!names.includes("Twice Only")); assert.ok(!names.includes("Grocery Store")); assert.ok(!names.includes("Employer payroll"));
const st = rec.find((r) => r.name === "Streamify")!; assert.equal(st.cadence, "monthly"); assert.ok(Math.abs(st.monthlyCost - 15.49) < 0.5); assert.ok(st.nextDate > "2026-10-01");
assert.ok(rec[0]!.monthlyCost >= rec.at(-1)!.monthlyCost, "largest first");
assert.deepEqual(c.detectRecurring([], "2026-10-04"), []);

// ---- insights
const today = "2026-10-10";
const sample = [
  T("2026-09-02", 1500, "Landlord", "RENT_AND_UTILITIES"), T("2026-09-04", 200, "Groceries", "FOOD_AND_DRINK"), T("2026-09-06", 100, "Fun", "ENTERTAINMENT"),
  T("2026-09-01", -4000, "Payroll", "INCOME"), T("2026-09-20", 700, "Later in Sep", "GENERAL_MERCHANDISE"),
  T("2026-08-02", 1500, "Landlord", "RENT_AND_UTILITIES"), T("2026-08-05", 500, "Stuff", "GENERAL_MERCHANDISE"), T("2026-07-02", 1500, "Landlord", "RENT_AND_UTILITIES"),
  T("2026-10-02", 1500, "Landlord", "RENT_AND_UTILITIES"), T("2026-10-04", 650, "Big Store", "GENERAL_MERCHANDISE", { merchant: "Big Store" }), T("2026-10-07", 90, "Dinner", "FOOD_AND_DRINK"),
];
const cardAcct = acct("credit", 420, { plaidAccountId: "cc1", name: "Everyday Card" });
const list = c.insights({ txns: sample, accounts: [acct("depository", 9000), cardAcct], liabilities: [{ accountId: "cc1", minimumPayment: 35, nextPaymentDue: "2026-10-14", lastStatementBalance: 410, isOverdue: false }], today });
const ids = list.map((i) => i.id);
assert.ok(ids.includes("mom")); assert.equal(list.find((i) => i.id === "mom")!.tone, "warn"); assert.match(list.find((i) => i.id === "mom")!.detail, /up/);
assert.ok(ids.includes("top-category")); assert.match(list.find((i) => i.id === "top-category")!.title, /Rent and utilities/);
assert.ok(ids.includes("big")); assert.match(list.find((i) => i.id === "big")!.detail, /\$650 at Big Store/);
const due = list.find((i) => i.id === "due-cc1")!; assert.match(due.title, /Everyday Card payment is due in 4 days/); assert.match(due.detail, /Minimum \$35\.00/);
assert.ok(ids.includes("runway")); assert.ok(ids.includes("savings")); assert.match(list.find((i) => i.id === "savings")!.title, /saved 38%/);
const overspent = c.insights({ txns: [T("2026-09-01", -1000, "Payroll", "INCOME"), T("2026-09-02", 1400, "Big month", "GENERAL_MERCHANDISE")], accounts: [], liabilities: [], today });
assert.equal(overspent.find((i) => i.id === "savings")!.title, "You spent 40% more than you earned last month"); assert.equal(overspent.find((i) => i.id === "savings")!.tone, "warn");
assert.deepEqual(c.insights({ txns: [], accounts: [], liabilities: [], today }), []);          // nothing to say yet, and no crash
assert.equal(c.fmtMoney(-1234.5), "-$1,235"); assert.equal(c.fmtMoney(1234.5, true), "$1,234.50"); assert.equal(c.fmtPct(0.256), "26%");

console.log("FINANCE CALC OK");
