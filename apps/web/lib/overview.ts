import "server-only";
import { groupLogDays, type Scope } from "./capture-core";
import { loadCaptureSince, loadDay, listSupplements } from "./capture";
import { calendarItems, itemsOnDay } from "./calendar";
import { classify, monthOf, netWorth, summarizeMonth } from "./finance-calc";
import { loadFinance } from "./finance-data";
import { addDays, startOfDay, todayInTz, ymd } from "./dates";
import { describeError } from "./errors";
import { calDigest, logDigest, sleepDigest, summarizeWeek } from "./overview-core";
import { loadNights } from "./sleep";
import { verifyBearer } from "./tokens";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const has = (scopes: readonly string[], s: Scope) => scopes.includes(s);
const READS: Scope[] = ["log:read", "calendar:read", "sleep:read", "finance:read"];

function mapCal(items: Awaited<ReturnType<typeof calendarItems>>) {
  return items.map((i) => calDigest(i, ymd));
}

export async function loadOverview(scopes: readonly string[], now = new Date()) {
  const today = todayInTz(now);
  const tomorrow = startOfDay(addDays(today, 1));
  const weekEnd = startOfDay(addDays(today, 8));
  const out: Record<string, unknown> = { date: today };

  const jobs: Promise<void>[] = [];
  if (has(scopes, "log:read")) {
    jobs.push(
      loadDay(today).then((d) => {
        out.log = logDigest(d.summary);
      }),
    );
  }
  if (has(scopes, "calendar:read")) {
    jobs.push(
      calendarItems(startOfDay(today), weekEnd).then((items) => {
        out.calendar = {
          today: mapCal(itemsOnDay(items, today)),
          upcoming: mapCal(items.filter((i) => i.start >= tomorrow).slice(0, 6)),
        };
      }),
    );
  }
  if (has(scopes, "sleep:read")) {
    jobs.push(
      loadNights(1).then((nights) => {
        out.sleep = { lastNight: sleepDigest(nights[0]) };
      }),
    );
  }
  if (has(scopes, "finance:read")) {
    jobs.push(
      loadFinance().then((f) => {
        if (!f.ok) {
          out.finance = null;
          return;
        }
        const nw = netWorth(f.accounts);
        const s = summarizeMonth(f.txns, monthOf(f.today));
        out.finance = { netWorth: nw.net, spendingThisMonth: s.spending };
      }),
    );
  }
  await Promise.all(jobs);
  return out;
}

export async function loadWeekSummary(scopes: readonly string[], now = new Date()) {
  const to = todayInTz(now);
  const from = addDays(to, -6);
  const days = has(scopes, "log:read")
    ? groupLogDays(await loadCaptureSince(startOfDay(from)), (ts) => ymd(ts)).filter((d) => d.day >= from && d.day <= to)
    : [];
  const nights = has(scopes, "sleep:read") ? (await loadNights(14)).filter((n) => n.day >= from && n.day <= to) : [];
  const eventCount = has(scopes, "calendar:read") ? (await calendarItems(startOfDay(from), startOfDay(addDays(to, 1)))).length : 0;
  let spending: number | null = null;
  if (has(scopes, "finance:read")) {
    const f = await loadFinance();
    if (f.ok) {
      spending = Math.round(f.txns.filter((t) => t.date >= from && t.date <= to && classify(t) === "spending").reduce((s, t) => s + t.amount, 0) * 100) / 100;
    }
  }
  return summarizeWeek({ from, to, days, nights, eventCount, spending: has(scopes, "finance:read") ? spending : null });
}

export async function loadOverviewForPage(now = new Date()) {
  const today = todayInTz(now);
  const [day, supplements] = await Promise.all([loadDay(today).catch(() => null), listSupplements().catch(() => [])]);
  return { date: today, log: day ? logDigest(day.summary) : null, supplementCount: supplements?.length ?? 0 };
}

export async function handleOverview(req: Request): Promise<Response> {
  const r = await verifyBearer(req.headers.get("authorization"));
  if (!r.ok) return json({ error: r.status === 401 ? "unauthorized" : "forbidden" }, r.status);
  if (!READS.some((s) => r.token.scopes.includes(s))) return json({ error: "forbidden" }, 403);
  try {
    return json(await loadOverview(r.token.scopes));
  } catch (e) {
    console.error("overview: could not load", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}
