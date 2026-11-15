import "server-only";
import { addDays, startOfDay, ymd } from "./dates";
import { calendarItems, loadCalendar, systemStatus, type CalendarItem } from "./calendar";
import { sessionsForItems, skippedItems, type SessionDetail } from "./calendar-sessions";
import { loadToday } from "./capture";
import { accountLabel, cashflowSeries, classify, insights, investmentRollup, lastMonths, merchantName, monthOf, netWorth, netWorthHistory, recurringBuckets, shiftMonthKey, subscriptionTrack, summarizeMonth, taggedRecurring } from "./finance-calc";
import { loadFinance, loadHoldings } from "./finance-data";
import { loadRecurringTags } from "./recurring";
import { listItems } from "./finance";
import { loadNights } from "./sleep";
import { loadActivities, totals } from "./activities";

// What the JSON API (and so the iPhone app) returns for each area. All-day items carry a plain
// YYYY-MM-DD; everything else is an ISO 8601 time. Nothing here is a secret: account numbers and
// credentials are never stored.
export const MAX_RANGE_DAYS = 90;

export const calendarJson = (i: CalendarItem, session?: SessionDetail) => ({
  id: i.id,
  title: i.title,
  start: i.allDay ? ymd(i.start) : i.start.toISOString(),
  end: i.allDay ? ymd(i.end) : i.end.toISOString(),
  allDay: i.allDay,
  kind: i.kind,
  location: i.location ?? null,
  session: session ?? null, // the goal session this event is, when it is one
});

export async function calendarRange(from: string, to: string) {
  const a = startOfDay(from), b = startOfDay(addDays(to, 1));
  const items = await calendarItems(a, b);
  const sessions = await sessionsForItems(items).catch(() => new Map<number, SessionDetail>());
  const skipped = await skippedItems(a, b).catch(() => ({ items: [] as CalendarItem[], sessions: new Map<number, SessionDetail>() }));
  return [...items.map((i) => calendarJson(i, sessions.get(i.id))), ...skipped.items.map((i) => calendarJson(i, skipped.sessions.get(i.id)))].sort((x, y) => x.start.localeCompare(y.start));
}

export async function sleepNights(limit: number) {
  return (await loadNights(limit)).map(({ sessions: _s, ...n }) => n);
}

// `detail` is the finance screen: a year of net worth, twelve months, and the tagged recurring charges.
// The home screen leaves it off so that call stays a snapshot.
export async function financeSummary(detail = false) {
  const f = await loadFinance();
  if (!f.ok) return null;
  const month = monthOf(f.today);
  const nw = netWorth(f.accounts);
  const span = lastMonths(month, detail ? 12 : 6);
  const base = {
    today: f.today,
    netWorth: { assets: nw.assets, liabilities: nw.liabilities, net: nw.net },
    groups: nw.groups.map((g) => ({
      key: g.key,
      label: g.label,
      total: g.total,
      accounts: g.accounts.map((a) => ({ name: accountLabel(a), institution: a.institution, subtype: a.subtype, balance: a.current })),
    })),
    thisMonth: summarizeMonth(f.txns, month),
    lastMonth: summarizeMonth(f.txns, shiftMonthKey(month, -1)),
    cashflow: cashflowSeries(f.txns, span),
    insights: insights({ txns: f.txns, accounts: f.accounts, liabilities: f.liabilities, today: f.today }),
  };
  if (!detail) return base;
  const tags = await loadRecurringTags().catch(() => []);
  const recurring = taggedRecurring(f.txns, tags, f.today);
  return {
    ...base,
    months: span.map((m) => summarizeMonth(f.txns, m)),
    history: netWorthHistory(f.accounts, f.txns, f.snapshots, f.today, 365),
    recurring: {
      monthly: Math.round(recurring.reduce((s, r) => s + r.monthlyCost, 0) * 100) / 100,
      buckets: recurringBuckets(recurring)
        .filter((b) => b.items.length > 0)
        .map((b) => ({
          id: b.id,
          label: b.label,
          total: b.total,
          items: b.items.map((r) => ({ key: r.key, name: r.name, amount: r.amount, cadence: r.cadence, nextDate: r.nextDate, monthlyCost: r.monthlyCost, on: r.on, count: r.count })),
        })),
      track: subscriptionTrack(recurring, f.txns, span),
    },
  };
}

export type TxnFilter = { text?: string; from?: string; to?: string; category?: string; limit?: number };

export async function searchTransactions(q: TxnFilter) {
  const f = await loadFinance();
  if (!f.ok) return null;
  const text = q.text?.trim().toLowerCase();
  return f.txns
    .filter((t) => (!text || merchantName(t).toLowerCase().includes(text) || t.name.toLowerCase().includes(text)) && (!q.from || t.date >= q.from) && (!q.to || t.date <= q.to) && (!q.category || t.category === q.category))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, q.limit ?? 25)
    .map((t) => ({ date: t.date, merchant: merchantName(t), amount: t.amount, category: t.category, kind: classify(t), pending: t.pending }));
}

export async function holdingsList() {
  return (await loadHoldings()).map(({ accountId: _a, ...h }) => h);
}

// Positions plus the allocation and gain the investments page shows. Gain ignores positions with no cost basis.
export async function holdingsReport() {
  const holdings = await holdingsList();
  return { holdings, summary: investmentRollup(holdings) };
}

export async function todayLog() {
  const { date, summary } = await loadToday();
  return {
    date,
    mood: summary.mood && { value: summary.mood.value, at: summary.mood.at.toISOString(), count: summary.mood.count },
    caffeine: { count: summary.caffeine.count, mg: summary.caffeine.mg, lastAt: summary.caffeine.lastAt?.toISOString() ?? null },
    supplements: summary.supplements.map((s) => ({ name: s.name, count: s.count, lastAt: s.lastAt.toISOString() })),
  };
}

// One call for the home screen. A section is left out (null) when the key lacks its scope.
export async function overview(has: (scope: string) => boolean, now = new Date()) {
  const today = ymd(now);
  const tomorrow = startOfDay(addDays(today, 1));
  const [todayRes, soonRes, nights, fin, log, fitness] = await Promise.all([
    has("calendar:read") ? loadCalendar(startOfDay(today), tomorrow) : null,
    has("calendar:read") ? loadCalendar(tomorrow, startOfDay(addDays(today, 8))) : null,
    has("sleep:read") ? sleepNights(1).catch(() => []) : null,
    has("finance:read") ? financeSummary().catch(() => null) : null,
    has("log:read") ? todayLog().catch(() => null) : null,
    has("fitness:read") ? fitnessSummary().catch(() => null) : null,
  ]);
  const status = has("calendar:read") || has("sleep:read") ? await systemStatus() : null;
  // Goal sessions ride along, as on the calendar endpoint, so a client can tell a done or skipped session from a planned one.
  const sessions = todayRes && soonRes
    ? await sessionsForItems([...todayRes.items, ...soonRes.items]).catch(() => new Map<number, SessionDetail>())
    : new Map<number, SessionDetail>();
  return {
    date: today,
    calendar: todayRes && soonRes && {
      today: todayRes.items.map((i) => calendarJson(i, sessions.get(i.id))),
      // Things already under way belong to today; "soon" lists what starts later.
      soon: soonRes.items.filter((i) => i.start >= tomorrow).map((i) => calendarJson(i, sessions.get(i.id))),
      failed: todayRes.failed || soonRes.failed,
      connected: status?.ok ? status.calendarConnected : false,
    },
    sleep: nights && { connected: status?.ok ? status.sleepConnected : false, lastNight: nights[0] ?? null },
    finance: fin && { netWorth: fin.netWorth, thisMonth: { income: fin.thisMonth.income, spending: fin.thisMonth.spending, net: fin.thisMonth.net }, insights: fin.insights.slice(0, 3) },
    log,
    fitness,
  };
}

export async function fitnessSummary(now = new Date()) {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const [recent, week] = await Promise.all([loadActivities({ limit: 1 }), loadActivities({ from: weekAgo, limit: 200 })]);
  return { last: recent[0] ?? null, week: totals(week) };
}

export async function connectionsStatus() {
  const [status, items] = await Promise.all([systemStatus(), listItems().catch(() => [])]);
  return {
    calendar: { provider: "Outlook", connected: status.ok && status.calendarConnected, syncedAt: status.ok ? (status.calendarSyncedAt?.toISOString() ?? null) : null },
    sleep: { provider: "Eight Sleep", connected: status.ok && status.sleepConnected },
    banks: items.map((i) => ({ institution: i.institutionName, kind: i.kind, status: i.status, error: i.lastError, syncedAt: i.lastSyncedAt?.toISOString() ?? null })),
  };
}
