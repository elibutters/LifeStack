import "server-only";
import { addDays, startOfDay, ymd } from "./dates";
import { calendarItems, loadCalendar, systemStatus, type CalendarItem } from "./calendar";
import { sessionsForItems, skippedItems, type SessionDetail } from "./calendar-sessions";
import { loadToday } from "./capture";
import { accountLabel, cashflowSeries, classify, insights, lastMonths, merchantName, monthOf, netWorth, shiftMonthKey, summarizeMonth } from "./finance-calc";
import { loadFinance, loadHoldings } from "./finance-data";
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

export async function calendarRange(from: string, to: string, now = new Date()) {
  const a = startOfDay(from), b = startOfDay(addDays(to, 1));
  const items = await calendarItems(a, b);
  const sessions = await sessionsForItems(items).catch(() => new Map<number, SessionDetail>());
  const skipped = await skippedItems(a, b, now).catch(() => ({ items: [] as CalendarItem[], sessions: new Map<number, SessionDetail>() }));
  return [...items.map((i) => calendarJson(i, sessions.get(i.id))), ...skipped.items.map((i) => calendarJson(i, skipped.sessions.get(i.id)))].sort((x, y) => x.start.localeCompare(y.start));
}

export async function sleepNights(limit: number) {
  return (await loadNights(limit)).map(({ sessions: _s, ...n }) => n);
}

export async function financeSummary() {
  const f = await loadFinance();
  if (!f.ok) return null;
  const month = monthOf(f.today);
  const nw = netWorth(f.accounts);
  return {
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
    cashflow: cashflowSeries(f.txns, lastMonths(month, 6)),
    insights: insights({ txns: f.txns, accounts: f.accounts, liabilities: f.liabilities, today: f.today }),
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
  return {
    date: today,
    calendar: todayRes && soonRes && {
      today: todayRes.items.map((i) => calendarJson(i)),
      // Things already under way belong to today; "soon" lists what starts later.
      soon: soonRes.items.filter((i) => i.start >= tomorrow).map((i) => calendarJson(i)),
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
