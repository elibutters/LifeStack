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
  nickname: string | null;
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
  TRANSFER: "Transfer",
  CC_PAYMENTS: "CC Payments",
  CASHBACK: "Cashback",
  ENTERTAINMENT: "Entertainment",
  FOOD_AND_DRINK: "Food And Drink",
  GENERAL_MERCHANDISE: "Shopping",
  HOME_IMPROVEMENT: "Home",
  MEDICAL: "Health",
  PERSONAL_CARE: "Personal Care",
  TRANSPORTATION: "Transportation",
  TRAVEL: "Travel",
  TECH: "Tech",
  RENT: "Rent",
  UTILITIES: "Utilities",
  OTHER: "Other",
};

export const titleCase = (s: string) =>
  s.toLowerCase().replace(/[_-]+/g, " ").replace(/\b([a-z])/g, (c) => c.toUpperCase());
export const isTransferCategory = (c: string | null) =>
  c === "TRANSFER" || c === "TRANSFER_IN" || c === "TRANSFER_OUT";
export const isCcPayment = (t: { category: string | null; detailed?: string | null }) =>
  t.category === "CC_PAYMENTS" || t.detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
export function mapPlaidCategory(category: string | null, detailed?: string | null): string | null {
  if (!category) return category;
  if (isTransferCategory(category)) return "TRANSFER";
  if (category === "CC_PAYMENTS" || detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") return "CC_PAYMENTS";
  if (category === "RENT_AND_UTILITIES") return detailed === "RENT_AND_UTILITIES_RENT" ? "RENT" : "UTILITIES";
  return category;
}
export const categoryKey = (t: { category: string | null; detailed?: string | null } | string | null) => {
  if (t == null) return t;
  if (typeof t === "string") return mapPlaidCategory(t);
  return mapPlaidCategory(t.category, t.detailed);
};
export const categoryLabel = (c: string | null) =>
  c ? (isTransferCategory(c) ? "Transfer" : (LABELS[c] ?? titleCase(c))) : "Uncategorized";
export const CATEGORY_KEYS = Object.keys(LABELS);

export type Kind = "spending" | "income" | "transfer";

// Moving money between your own accounts and paying a credit card are not spending (the card's own
// purchases already are), and counting them would double everything.
export function classify(t: Pick<Txn, "amount" | "category" | "detailed">): Kind {
  if (isTransferCategory(t.category) || t.category === "CC_PAYMENTS") return "transfer";
  if (t.category === "LOAN_PAYMENTS" && t.detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") return "transfer";
  if (t.amount < 0 && (t.category === "INCOME" || t.category === "CASHBACK")) return "income";
  return "spending"; // outflows, and refunds (negative, non-income) which net against spending
}

const cents = (n: number) => Math.round(n * 100);
const isSofi = (t: Pick<Txn, "name" | "merchant">) => /sofi/i.test(`${t.merchant ?? ""} ${t.name}`);

// SoFi posts a card payment as two same-day legs of equal size (out of cash, into the card).
// A leftover SoFi credit under $100 on that day is cashback.
export function inferSofiAutoCategories(txns: Txn[]): Map<string, string> {
  const out = new Map<string, string>();
  const byDay = new Map<string, Txn[]>();
  for (const t of txns) {
    const list = byDay.get(t.date) ?? [];
    list.push(t);
    byDay.set(t.date, list);
  }
  for (const day of byDay.values()) {
    const sofi = day.filter(isSofi);
    if (!sofi.length) continue;
    const used = new Set<string>();
    let pair = false;
    for (const a of sofi) {
      if (used.has(a.id) || cents(a.amount) === 0) continue;
      const b = day.find((t) => t.id !== a.id && !used.has(t.id) && cents(t.amount) === -cents(a.amount));
      if (!b) continue;
      used.add(a.id);
      used.add(b.id);
      out.set(a.id, "CC_PAYMENTS");
      out.set(b.id, "CC_PAYMENTS");
      pair = true;
    }
    if (!pair) continue;
    for (const t of sofi) {
      if (used.has(t.id)) continue;
      const n = cents(t.amount);
      if (n < 0 && n > -10000) out.set(t.id, "CASHBACK");
    }
  }
  return out;
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
  incomeByCategory: CategoryTotal[];
  topIncome: MerchantTotal[];
};

export const merchantName = (t: Pick<Txn, "merchant" | "name">) => (t.merchant ?? t.name).trim();
export const accountLabel = (a: { name: string; nickname?: string | null }) => a.nickname?.trim() || a.name;

export function summarizeMonth(txns: Txn[], month: string): MonthSummary {
  let income = 0;
  let spending = 0;
  const cats = new Map<string | null, CategoryTotal>();
  const merchants = new Map<string, MerchantTotal>();
  const inCats = new Map<string | null, CategoryTotal>();
  const inMerchants = new Map<string, MerchantTotal>();
  for (const t of txns) {
    if (monthOf(t.date) !== month) continue;
    const kind = classify(t);
    if (kind === "income") {
      const amt = -t.amount;
      income += amt;
      const c = inCats.get(t.category) ?? { category: t.category, label: categoryLabel(t.category), amount: 0, count: 0 };
      c.amount += amt;
      c.count++;
      inCats.set(t.category, c);
      const key = merchantName(t);
      const m = inMerchants.get(key) ?? { name: key, amount: 0, count: 0 };
      m.amount += amt;
      m.count++;
      inMerchants.set(key, m);
    } else if (kind === "spending") {
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
  const incomeByCategory = [...inCats.values()].filter((c) => c.amount > 0.005).map((c) => ({ ...c, amount: round2(c.amount) })).sort((a, b) => b.amount - a.amount);
  const topIncome = [...inMerchants.values()].filter((m) => m.amount > 0.005).map((m) => ({ ...m, amount: round2(m.amount) })).sort((a, b) => b.amount - a.amount).slice(0, 10);
  income = round2(income);
  spending = round2(spending);
  return { month, income, spending, net: round2(income - spending), savingsRate: income > 0 ? (income - spending) / income : null, byCategory, topMerchants, incomeByCategory, topIncome };
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

export type BalanceSnap = { accountId: string; day: string; value: number; type: string };

// Cash and cards rebuilt from transactions; investments and loans from daily snapshots once linked.
export function netWorthHistory(
  accounts: AccountInfo[],
  txns: Txn[],
  snapshots: BalanceSnap[],
  today: string,
  days: number,
): HistoryPoint[] {
  const cash = cashPositionHistory(accounts, txns, today, days);
  const rest: BalanceSnap[] = snapshots.filter((s) => s.type !== "depository" && s.type !== "credit");
  for (const a of accounts) {
    if (a.current == null || a.type === "depository" || a.type === "credit") continue;
    rest.push({ accountId: a.plaidAccountId, day: today, value: a.current, type: a.type });
  }
  const extra = snapshotNetWorth(rest);
  if (!cash.length) return extra;
  if (!extra.length) return cash;
  const byDay = new Map(extra.map((p) => [p.day, p.value]));
  const first = extra[0]!.day;
  const last = extra.at(-1)!.value;
  return cash.map((p) => ({ day: p.day, value: round2(p.value + (p.day < first ? 0 : (byDay.get(p.day) ?? last))) }));
}

// Daily snapshots stored over time, with each account's last known value carried forward.
export function snapshotNetWorth(rows: BalanceSnap[]): HistoryPoint[] {
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
export const CADENCE_OPTIONS = ["weekly", "every two weeks", "monthly", "quarterly", "yearly"] as const;
export type RecurringCadence = (typeof CADENCE_OPTIONS)[number];
export const BUCKET_OPTIONS = ["rent", "utils", "other"] as const;
export type RecurringBucket = (typeof BUCKET_OPTIONS)[number];
export const BUCKET_LABEL: Record<RecurringBucket, string> = { rent: "Rent", utils: "Utilities", other: "Other" };
export function bucketFromCategory(category: string | null): RecurringBucket {
  if (category === "RENT") return "rent";
  if (category === "UTILITIES" || category === "RENT_AND_UTILITIES") return "utils";
  return "other";
}
export type RecurringTag = { key: string; name: string; cadence: RecurringCadence; bucket: RecurringBucket };

export type Recurring = {
  name: string;
  key: string;
  amount: number;
  cadence: RecurringCadence;
  bucket: RecurringBucket;
  gapDays: number;
  count: number;
  firstDate: string;
  lastDate: string;
  nextDate: string;
  monthlyCost: number;
  on: string | null;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function ordinal(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (k >= 11 && k <= 13) return `${n}th`;
  if (j === 1) return `${n}st`;
  if (j === 2) return `${n}nd`;
  if (j === 3) return `${n}rd`;
  return `${n}th`;
}

// Typical calendar day a monthly charge lands on. Late-month dates are "end of month"
// because those move with the length of the month.
export function monthOn(days: string[]): string {
  const d = Math.round(median(days.map((day) => Number(day.slice(8)))));
  if (d >= 28) return "end of month";
  return ordinal(d);
}

export function yearOn(days: string[]): string {
  const m = Math.round(median(days.map((day) => Number(day.slice(5, 7)))));
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Math.min(11, Math.max(0, m - 1))]!;
}

const CADENCES: { name: RecurringCadence; min: number; max: number }[] = [
  { name: "weekly", min: 6, max: 8 },
  { name: "every two weeks", min: 13, max: 16 },
  { name: "monthly", min: 26, max: 35 },
  { name: "quarterly", min: 85, max: 95 },
  { name: "yearly", min: 320, max: 400 },
];

// Weekly and similar cadences are scaled to a month. A monthly charge is already a month.
function monthlyCost(typical: number, cadence: RecurringCadence, gap: number): number {
  switch (cadence) {
    case "monthly":
      return round2(typical);
    case "quarterly":
      return round2(typical / 3);
    case "yearly":
      return round2(typical / 12);
    default:
      return round2((typical * 30.4) / gap);
  }
}

export const merchantKey = (t: Pick<Txn, "merchant" | "name">) =>
  merchantName(t)
    .toLowerCase()
    .replace(/[0-9#*]+/g, " ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const defaultGap = (cadence: RecurringCadence) =>
  cadence === "weekly" ? 7 : cadence === "every two weeks" ? 14 : cadence === "quarterly" ? 91 : cadence === "yearly" ? 365 : 30;

const fromGroup = (key: string, list: Txn[], cadence: RecurringCadence, name: string, today: string, bucket: RecurringBucket): Recurring => {
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  const days = [...new Set(sorted.map((t) => t.date))];
  const typical = sorted.at(-1)?.amount ?? 0;
  const gaps = days.slice(1).map((d, i) => dayNum(d) - dayNum(days[i]!));
  const gap = gaps.length ? median(gaps) : defaultGap(cadence);
  const lastDate = days.at(-1) ?? today;
  const firstDate = days[0] ?? today;
  const on = cadence === "monthly" && days.length ? monthOn(days) : cadence === "yearly" && days.length ? yearOn(days) : null;
  return {
    name,
    key,
    amount: round2(typical),
    cadence,
    bucket,
    gapDays: Math.round(gap),
    count: days.length,
    firstDate,
    lastDate,
    nextDate: dayStr(dayNum(lastDate) + Math.round(gap)),
    monthlyCost: typical ? monthlyCost(typical, cadence, gap) : 0,
    on,
  };
};

export function detectRecurring(txns: Txn[], today: string): Recurring[] {
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    if (t.pending || t.amount <= 0 || classify(t) !== "spending") continue;
    const key = merchantKey(t);
    if (key.length < 2) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  const out: Recurring[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const days = [...new Set(sorted.map((t) => t.date))];
    if (days.length < 2) continue;
    const amounts = sorted.map((t) => t.amount);
    const typical = median(amounts);
    if (!typical || amounts.filter((a) => Math.abs(a - typical) / typical <= 0.35).length / amounts.length < 0.7) continue;
    const gaps = days.slice(1).map((d, i) => dayNum(d) - dayNum(days[i]!));
    const gap = median(gaps);
    const hit = CADENCES.find((c) => gap >= c.min && gap <= c.max);
    if (!hit) continue;
    if (days.length < (hit.name === "yearly" ? 2 : 3)) continue;
    const onBeat = gaps.filter((g) => g >= hit.min && g <= hit.max).length;
    if (onBeat / gaps.length < 0.7) continue;
    const lastDate = days.at(-1)!;
    if (dayNum(today) - dayNum(lastDate) > gap * 1.6) continue;
    const row = fromGroup(key, list, hit.name, sorted.at(-1)!.merchant ?? sorted.at(-1)!.name, today, "other");
    out.push(row);
  }
  return out.sort((a, b) => b.monthlyCost - a.monthlyCost);
}

export function taggedRecurring(txns: Txn[], tags: RecurringTag[], today: string): Recurring[] {
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    if (t.pending || t.amount <= 0 || classify(t) !== "spending") continue;
    const key = merchantKey(t);
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  const out: Recurring[] = [];
  for (const tag of tags) {
    const list = groups.get(tag.key) ?? [];
    const inferred = bucketFromCategory(list.at(-1)?.category ?? null);
    const bucket = tag.bucket === "other" && inferred !== "other" ? inferred : tag.bucket;
    const row = fromGroup(tag.key, list, tag.cadence, tag.name, today, bucket);
    out.push(row);
  }
  return out.sort((a, b) => b.monthlyCost - a.monthlyCost);
}

export function recurringBuckets(list: Recurring[]) {
  return BUCKET_OPTIONS.map((id) => {
    const items = list.filter((r) => r.bucket === id);
    return { id, label: BUCKET_LABEL[id], items, total: round2(items.reduce((s, r) => s + r.monthlyCost, 0)) };
  });
}

export type MerchantChoice = { key: string; name: string; count: number; lastAmount: number; lastDate: string };

export function merchantChoices(txns: Txn[]): MerchantChoice[] {
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    if (t.pending || t.amount <= 0 || classify(t) !== "spending") continue;
    const key = merchantKey(t);
    if (key.length < 2) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const last = [...list].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!;
      return { key, name: last.merchant ?? last.name, count: new Set(list.map((t) => t.date)).size, lastAmount: last.amount, lastDate: last.date };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type MonthSubs = { month: string; budget: number; cash: number };

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}

// What we expect to actually post in that calendar month (not the smoothed /mo share).
function expectedInMonth(r: Recurring, month: string): number {
  if (monthOf(r.firstDate) > month) return 0;
  if (r.cadence === "monthly") return r.amount;
  if (r.cadence === "yearly") return month.slice(5) === r.lastDate.slice(5, 7) ? r.amount : 0;
  if (r.cadence === "quarterly") return monthsBetween(monthOf(r.firstDate), month) % 3 === 0 ? r.amount : 0;
  return r.monthlyCost;
}

// Budget is the amount expected to post that month. Cash is what actually posted.
export function subscriptionTrack(recurring: Recurring[], txns: Txn[], months: string[]): MonthSubs[] {
  const keys = new Set(recurring.map((r) => r.key));
  return months.map((month) => {
    let cash = 0;
    for (const t of txns) {
      if (monthOf(t.date) !== month || t.pending || t.amount <= 0 || classify(t) !== "spending") continue;
      if (keys.has(merchantKey(t))) cash += t.amount;
    }
    let budget = 0;
    for (const r of recurring) budget += expectedInMonth(r, month);
    return { month, budget: round2(budget), cash: round2(cash) };
  });
}

export type SubMonthHit = { key: string; name: string; posted: number; txns: { date: string; amount: number }[] };

export function subscriptionMonthHits(recurring: Recurring[], txns: Txn[], month: string): SubMonthHit[] {
  return recurring.map((r) => {
    const hits = txns
      .filter((t) => monthOf(t.date) === month && !t.pending && t.amount > 0 && classify(t) === "spending" && merchantKey(t) === r.key)
      .sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
    return { key: r.key, name: r.name, posted: round2(hits.reduce((s, t) => s + t.amount, 0)), txns: hits.map((t) => ({ date: t.date, amount: t.amount })) };
  });
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

  // Bills such as rent and loan payments are not purchases, so they are not the "largest purchase".
  const bills = new Set(["RENT", "UTILITIES", "RENT_AND_UTILITIES", "LOAN_PAYMENTS", "CC_PAYMENTS"]);
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
        title: `${accountLabel(acct)} payment ${days <= 0 ? "is due now" : `is due in ${days} day${days === 1 ? "" : "s"}`}`,
        detail: `${l.minimumPayment != null ? `Minimum ${fmtMoney(l.minimumPayment)}. ` : ""}${l.lastStatementBalance != null ? `Statement balance ${fmtMoney(l.lastStatementBalance)}.` : ""}`.trim(),
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
    if (dayNum(today) - dayNum(r.firstDate) <= 45 && r.count <= 3) out.push({ id: `new-${r.name}`, tone: "info", title: `New recurring charge: ${r.name}`, detail: `${fmtMoney(r.amount)} ${r.cadence}.` });
  }
  return out;
}
