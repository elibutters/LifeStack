// Pure finance maths: no database, no server-only imports, so it can be tested on its own.
// Sign convention (Plaid's): a transaction amount is positive for money going OUT and negative for
// money coming IN. Credit card and loan balances are the amount owed, as a positive number.
export type Txn = {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  name: string;
  merchant: string | null;
  category: string | null;
  detailed: string | null;
  pending: boolean;
  accountId: string; // Plaid account id
};

export type AccountInfo = {
  id: number;
  plaidAccountId: string;
  name: string;
  institution: string | null;
  type: string; // depository | credit | loan | investment | other
  subtype: string | null;
  current: number | null;
  available: number | null;
  limit: number | null;
  balanceAt: Date | null;
};

export type Liability = {
  accountId: string;
  minimumPayment: number | null;
  nextPaymentDue: string | null;
  lastStatementBalance: number | null;
  isOverdue: boolean | null;
};

const LABELS: Record<string, string> = {
  INCOME: "Income",
  TRANSFER_IN: "Transfers in",
  TRANSFER_OUT: "Transfers out",
  LOAN_PAYMENTS: "Loan payments",
  BANK_FEES: "Bank fees",
  ENTERTAINMENT: "Entertainment",
  FOOD_AND_DRINK: "Food and drink",
  GENERAL_MERCHANDISE: "Shopping",
  HOME_IMPROVEMENT: "Home",
  MEDICAL: "Health",
  PERSONAL_CARE: "Personal care",
  GENERAL_SERVICES: "Services",
  GOVERNMENT_AND_NON_PROFIT: "Government and giving",
  TRANSPORTATION: "Transportation",
  TRAVEL: "Travel",
  RENT_AND_UTILITIES: "Rent and utilities",
  OTHER: "Other",
};

const titleCase = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
export const categoryLabel = (c: string | null) => (c ? (LABELS[c] ?? titleCase(c)) : "Uncategorized");
export const CATEGORY_KEYS = Object.keys(LABELS);

export type Kind = "spending" | "income" | "transfer";

// Moving money between your own accounts and paying a credit card are not spending (the card's own
// purchases already are), and counting them would double everything.
export function classify(t: Pick<Txn, "amount" | "category" | "detailed">): Kind {
  if (t.category === "TRANSFER_IN" || t.category === "TRANSFER_OUT" || t.detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") return "transfer";
  if (t.amount < 0 && t.category === "INCOME") return "income";
  return "spending"; // outflows, and refunds (negative, non-income) which net against spending
}

export const monthOf = (date: string) => date.slice(0, 7);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function shiftMonthKey(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function lastMonths(endMonth: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftMonthKey(endMonth, i - (n - 1)));
}

export type CategoryTotal = { category: string | null; label: string; amount: number; count: number };
export type MerchantTotal = { name: string; amount: number; count: number };
export type MonthSummary = {
  month: string;
  income: number;
  spending: number;
  net: number;
  savingsRate: number | null;
  byCategory: CategoryTotal[];
  topMerchants: MerchantTotal[];
};

export const merchantName = (t: Pick<Txn, "merchant" | "name">) => (t.merchant ?? t.name).trim();

export function summarizeMonth(txns: Txn[], month: string): MonthSummary {
  let income = 0;
  let spending = 0;
  const cats = new Map<string | null, CategoryTotal>();
  const merchants = new Map<string, MerchantTotal>();
  for (const t of txns) {
    if (monthOf(t.date) !== month) continue;
    const kind = classify(t);
    if (kind === "income") income += -t.amount;
    else if (kind === "spending") {
      spending += t.amount;
      const c = cats.get(t.category) ?? { category: t.category, label: categoryLabel(t.category), amount: 0, count: 0 };
      c.amount += t.amount;
      c.count++;
      cats.set(t.category, c);
      const key = merchantName(t);
      const m = merchants.get(key) ?? { name: key, amount: 0, count: 0 };
      m.amount += t.amount;
      m.count++;
      merchants.set(key, m);
    }
  }
  const byCategory = [...cats.values()].filter((c) => c.amount > 0.005).map((c) => ({ ...c, amount: round2(c.amount) })).sort((a, b) => b.amount - a.amount);
  const topMerchants = [...merchants.values()].filter((m) => m.amount > 0.005).map((m) => ({ ...m, amount: round2(m.amount) })).sort((a, b) => b.amount - a.amount).slice(0, 10);
  income = round2(income);
  spending = round2(spending);
  return { month, income, spending, net: round2(income - spending), savingsRate: income > 0 ? (income - spending) / income : null, byCategory, topMerchants };
}

export function cashflowSeries(txns: Txn[], months: string[]) {
  return months.map((month) => {
    const s = summarizeMonth(txns, month);
    return { month, income: s.income, spending: s.spending };
  });
}

// ---- accounts and net worth
export type Group = { key: "cash" | "credit" | "investments" | "loans" | "other"; label: string; total: number; accounts: AccountInfo[] };

const groupOf = (a: AccountInfo): Group["key"] =>
  a.type === "depository" ? "cash" : a.type === "credit" ? "credit" : a.type === "investment" ? "investments" : a.type === "loan" ? "loans" : "other";
const GROUP_LABELS: Record<Group["key"], string> = { cash: "Cash", credit: "Credit cards", investments: "Investments", loans: "Loans", other: "Other" };
export const isLiability = (a: Pick<AccountInfo, "type">) => a.type === "credit" || a.type === "loan";

export function netWorth(accounts: AccountInfo[]) {
  const map = new Map<Group["key"], Group>();
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    const v = a.current ?? 0;
    const key = groupOf(a);
    const g = map.get(key) ?? { key, label: GROUP_LABELS[key], total: 0, accounts: [] };
    g.accounts.push(a);
    g.total += v;
    map.set(key, g);
    if (isLiability(a)) liabilities += v;
    else assets += v;
  }
  const order: Group["key"][] = ["cash", "credit", "investments", "loans", "other"];
  const groups = order.map((k) => map.get(k)).filter((g): g is Group => !!g);
  return { assets: round2(assets), liabilities: round2(liabilities), net: round2(assets - liabilities), groups };
}

// ---- history
export type HistoryPoint = { day: string; value: number };

const dayNum = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;
const dayStr = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

// "Cash and cards over time": rebuilt from today's balance by undoing each posted transaction, going
// backwards. Cash is worth current + everything that left the account since; a card's debt was
// current minus what was charged since. Investments cannot be rebuilt this way (markets move), so
// they are left out; they are tracked from the day they were linked.
export function cashPositionHistory(accounts: AccountInfo[], txns: Txn[], today: string, days: number): HistoryPoint[] {
  const cashAccounts = accounts.filter((a) => (a.type === "depository" || a.type === "credit") && a.current != null);
  if (!cashAccounts.length) return [];
  const start = dayNum(today) - days;
  const byAccount = new Map<string, Txn[]>();
  for (const t of txns) if (!t.pending) (byAccount.get(t.accountId) ?? byAccount.set(t.accountId, []).get(t.accountId)!).push(t);
  const totals = new Array<number>(days + 1).fill(0);
  for (const a of cashAccounts) {
    const sign = a.type === "credit" ? -1 : 1; // credit balances are debt: they subtract from the position
    const deltaByDay = new Map<number, number>();
    for (const t of byAccount.get(a.plaidAccountId) ?? []) {
      const n = dayNum(t.date);
      deltaByDay.set(n, (deltaByDay.get(n) ?? 0) + t.amount);
    }
    // balance at end of day D = current + (sum of amounts after D) for cash; current - (sum after D) for cards
    let running = a.current!;
    for (let i = days; i >= 0; i--) {
      const n = start + i;
      totals[i]! += sign * running;
      const spentOn = deltaByDay.get(n) ?? 0;
      running = a.type === "credit" ? running - spentOn : running + spentOn;
    }
  }
  return totals.map((v, i) => ({ day: dayStr(start + i), value: round2(v) }));
}

// Daily snapshots stored over time, with each account's last known value carried forward.
export function snapshotNetWorth(rows: { accountId: string; day: string; value: number; type: string }[]): HistoryPoint[] {
  if (!rows.length) return [];
  const days = [...new Set(rows.map((r) => r.day))].sort();
  const last = new Map<string, { value: number; liability: boolean }>();
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) (byDay.get(r.day) ?? byDay.set(r.day, []).get(r.day)!).push(r);
  const out: HistoryPoint[] = [];
  for (let n = dayNum(days[0]!); n <= dayNum(days.at(-1)!); n++) {
    const day = dayStr(n);
    for (const r of byDay.get(day) ?? []) last.set(r.accountId, { value: r.value, liability: r.type === "credit" || r.type === "loan" });
    let total = 0;
    for (const v of last.values()) total += v.liability ? -v.value : v.value;
    out.push({ day, value: round2(total) });
  }
  return out;
}

// ---- recurring charges
export type Recurring = {
  name: string;
  amount: number;
  cadence: "weekly" | "every two weeks" | "monthly" | "quarterly" | "yearly";
  gapDays: number;
  count: number;
  firstDate: string;
  lastDate: string;
  nextDate: string;
  monthlyCost: number;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const CADENCES: { name: Recurring["cadence"]; min: number; max: number }[] = [
  { name: "weekly", min: 6, max: 8 },
  { name: "every two weeks", min: 13, max: 16 },
  { name: "monthly", min: 26, max: 35 },
  { name: "quarterly", min: 85, max: 95 },
  { name: "yearly", min: 355, max: 375 },
];

const normName = (t: Txn) =>
  merchantName(t)
    .toLowerCase()
    .replace(/[0-9#*]+/g, " ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function detectRecurring(txns: Txn[], today: string): Recurring[] {
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    if (t.pending || t.amount <= 0 || classify(t) !== "spending") continue;
    const key = normName(t);
    if (key.length < 2) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  const out: Recurring[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    // several charges on one day count once
    const days = [...new Set(sorted.map((t) => t.date))];
    if (days.length < 3) continue;
    const gaps = days.slice(1).map((d, i) => dayNum(d) - dayNum(days[i]!));
    const gap = median(gaps);
    const cadence = CADENCES.find((c) => gap >= c.min && gap <= c.max);
    if (!cadence) continue;
    const onBeat = gaps.filter((g) => g >= cadence.min && g <= cadence.max).length;
    if (onBeat / gaps.length < 0.7) continue;
    const amounts = sorted.map((t) => t.amount);
    const typical = median(amounts);
    if (amounts.filter((a) => Math.abs(a - typical) / typical <= 0.35).length / amounts.length < 0.7) continue;
    const lastDate = days.at(-1)!;
    if (dayNum(today) - dayNum(lastDate) > gap * 1.6) continue; // stopped
    out.push({
      name: sorted.at(-1)!.merchant ?? sorted.at(-1)!.name,
      amount: round2(typical),
      cadence: cadence.name,
      gapDays: Math.round(gap),
      count: days.length,
      firstDate: days[0]!,
      lastDate,
      nextDate: dayStr(dayNum(lastDate) + Math.round(gap)),
      monthlyCost: round2((typical * 30.4) / gap),
    });
  }
  return out.sort((a, b) => b.monthlyCost - a.monthlyCost);
}

// ---- insights
export type Insight = { id: string; tone: "good" | "warn" | "info"; title: string; detail: string };

export const fmtMoney = (n: number, cents = false) => {
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return n < 0 ? `-${s}` : s;
};
export const fmtPct = (x: number) => `${Math.round(x * 100)}%`;

export function insights(input: { txns: Txn[]; accounts: AccountInfo[]; liabilities: Liability[]; today: string }): Insight[] {
  const { txns, accounts, liabilities, today } = input;
  const out: Insight[] = [];
  const month = monthOf(today);
  const prev = shiftMonthKey(month, -1);
  const dom = Number(today.slice(8));
  const upToDay = (m: string) => txns.filter((t) => monthOf(t.date) === m && Number(t.date.slice(8)) <= dom);

  // spending so far this month vs the same stretch of last month
  const nowSoFar = summarizeMonth(upToDay(month), month).spending;
  const prevSoFar = summarizeMonth(upToDay(prev), prev).spending;
  if (prevSoFar > 200 && Math.abs(nowSoFar - prevSoFar) / prevSoFar >= 0.15 && Math.abs(nowSoFar - prevSoFar) >= 100) {
    const up = nowSoFar > prevSoFar;
    out.push({
      id: "mom",
      tone: up ? "warn" : "good",
      title: up ? "Spending is up this month" : "Spending is down this month",
      detail: `${fmtMoney(nowSoFar)} so far, ${up ? "up" : "down"} ${fmtPct(Math.abs(nowSoFar - prevSoFar) / prevSoFar)} from ${fmtMoney(prevSoFar)} by the same day last month.`,
    });
  }

  const cur = summarizeMonth(txns, month);
  if (cur.byCategory[0] && cur.spending > 0) {
    const c = cur.byCategory[0];
    out.push({ id: "top-category", tone: "info", title: `${c.label} is your biggest category`, detail: `${fmtMoney(c.amount)} this month, ${fmtPct(c.amount / cur.spending)} of your spending.` });
  }

  // Bills such as rent and loan payments are not purchases, so they are not the "largest purchase".
  const bills = new Set(["RENT_AND_UTILITIES", "LOAN_PAYMENTS"]);
  const big = txns.filter((t) => monthOf(t.date) === month && classify(t) === "spending" && !bills.has(t.category ?? "") && t.amount >= 300).sort((a, b) => b.amount - a.amount)[0];
  if (big) out.push({ id: "big", tone: "info", title: "Largest purchase this month", detail: `${fmtMoney(big.amount)} at ${merchantName(big)} on ${big.date}.` });

  // card payments coming up
  for (const l of liabilities) {
    if (!l.nextPaymentDue) continue;
    const days = Math.round(dayNum(l.nextPaymentDue) - dayNum(today));
    const acct = accounts.find((a) => a.plaidAccountId === l.accountId);
    if (days >= -1 && days <= 10 && acct) {
      out.push({
        id: `due-${l.accountId}`,
        tone: l.isOverdue ? "warn" : days <= 3 ? "warn" : "info",
        title: `${acct.name} payment ${days <= 0 ? "is due now" : `is due in ${days} day${days === 1 ? "" : "s"}`}`,
        detail: `${l.minimumPayment != null ? `Minimum ${fmtMoney(l.minimumPayment, true)}. ` : ""}${l.lastStatementBalance != null ? `Statement balance ${fmtMoney(l.lastStatementBalance, true)}.` : ""}`.trim(),
      });
    }
  }

  // how long cash lasts at the recent pace
  const cash = accounts.filter((a) => a.type === "depository").reduce((s, a) => s + (a.current ?? 0), 0);
  const recent = lastMonths(prev, 3).map((m) => summarizeMonth(txns, m).spending).filter((s) => s > 0);
  if (cash > 0 && recent.length >= 2) {
    const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
    if (avg > 0) out.push({ id: "runway", tone: cash / avg >= 3 ? "good" : "warn", title: `Cash covers about ${(cash / avg).toFixed(1)} months of spending`, detail: `${fmtMoney(cash)} in cash against about ${fmtMoney(avg)} a month over the last ${recent.length} months.` });
  }

  const last = summarizeMonth(txns, prev);
  if (last.savingsRate != null && last.income > 0) {
    const rate = last.savingsRate;
    out.push({
      id: "savings",
      tone: rate >= 0.2 ? "good" : rate < 0 ? "warn" : "info",
      title: rate < 0 ? `You spent ${fmtPct(-rate)} more than you earned last month` : `You saved ${fmtPct(rate)} of your income last month`,
      detail: `${fmtMoney(last.income)} came in and ${fmtMoney(last.spending)} went out.`,
    });
  }

  // subscriptions that started recently
  for (const r of detectRecurring(txns, today)) {
    if (dayNum(today) - dayNum(r.firstDate) <= 45 && r.count <= 3) out.push({ id: `new-${r.name}`, tone: "info", title: `New recurring charge: ${r.name}`, detail: `${fmtMoney(r.amount, true)} ${r.cadence}.` });
  }
  return out;
}
