import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/card";
import { BarRows, CashflowColumns } from "@/components/charts";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { requireSession } from "@/lib/auth";
import { fmtMonth, isValidMonth } from "@/lib/dates";
import { loadFinance } from "@/lib/finance-data";
import { cashflowSeries, fmtMoney, fmtPct, lastMonths, monthOf, shiftMonthKey, summarizeMonth } from "@/lib/finance-calc";

export const metadata: Metadata = { title: "Flow" };
export const dynamic = "force-dynamic";

const arrow = "grid h-11 w-11 place-items-center rounded-md text-muted hover:bg-raised hover:text-fg";
const href = (m: string) => `/finance/flow?m=${m}`;

export default async function Flow({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const data = await loadFinance();
  if (!data.ok) return <p className="text-danger">Couldn't load your finance data. Try again shortly.</p>;
  const thisMonth = monthOf(data.today);
  const month = isValidMonth(sp.m) && sp.m <= thisMonth ? sp.m : thisMonth;
  const s = summarizeMonth(data.txns, month);
  const prev = summarizeMonth(data.txns, shiftMonthKey(month, -1));
  const flow = cashflowSeries(data.txns, lastMonths(thisMonth, 12));
  const outDelta = prev.spending > 0 ? (s.spending - prev.spending) / prev.spending : null;
  const inDelta = prev.income > 0 ? (s.income - prev.income) / prev.income : null;

  return (
    <div className="space-y-4">
      <Card title="Money in and out, last 12 months">
        <CashflowColumns data={flow} highlight={month} hrefFor={href} />
        <p className="mt-3 text-xs text-muted">Transfers between your accounts and credit card payments are left out so nothing is counted twice.</p>
      </Card>

      <div className="flex items-center gap-2">
        <h2 className="mr-auto text-xl font-semibold tracking-tight">{fmtMonth(month)}</h2>
        <Link href={href(shiftMonthKey(month, -1))} aria-label="Previous month" className={arrow}><ChevronLeftIcon /></Link>
        {month < thisMonth ? (
          <Link href={href(shiftMonthKey(month, 1))} aria-label="Next month" className={arrow}><ChevronRightIcon /></Link>
        ) : (
          <span className={`${arrow} opacity-30`} aria-hidden="true"><ChevronRightIcon /></span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Money in", value: fmtMoney(s.income), tone: "text-ok", sub: inDelta != null ? `${inDelta >= 0 ? "up" : "down"} ${fmtPct(Math.abs(inDelta))} vs last month` : undefined },
          { label: "Money out", value: fmtMoney(s.spending), tone: "text-danger", sub: outDelta != null ? `${outDelta >= 0 ? "up" : "down"} ${fmtPct(Math.abs(outDelta))} vs last month` : undefined },
          { label: "Left over", value: fmtMoney(s.net), tone: s.net < 0 ? "text-danger" : "text-ok" },
          { label: "Savings rate", value: s.savingsRate == null ? "n/a" : fmtPct(s.savingsRate), tone: "" },
        ].map((t) => (
          <div key={t.label} className="rounded-md border border-line bg-surface p-4">
            <p className="text-sm text-muted">{t.label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${t.tone}`}>{t.value}</p>
            {t.sub && <p className="mt-0.5 text-xs text-muted">{t.sub}</p>}
          </div>
        ))}
      </div>

      <Card title="Spending">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div>
            <h3 className="mb-3 text-sm text-muted">By category</h3>
            {s.byCategory.length ? (
              <BarRows
                tone="out"
                total={s.spending}
                items={s.byCategory.map((c) => ({
                  label: c.label,
                  amount: c.amount,
                  sub: `${c.count} transaction${c.count === 1 ? "" : "s"}`,
                  href: `/finance/transactions?cat=${c.category ?? ""}&m=${month}&kind=spending`,
                }))}
              />
            ) : (
              <p className="py-2 text-muted">No spending this month.</p>
            )}
          </div>
          <div>
            <h3 className="mb-3 text-sm text-muted">Top merchants</h3>
            {s.topMerchants.length ? (
              <BarRows
                tone="out"
                items={s.topMerchants.map((m) => ({ label: m.name, amount: m.amount, sub: `${m.count} transaction${m.count === 1 ? "" : "s"}` }))}
              />
            ) : (
              <p className="py-2 text-muted">Nothing to show.</p>
            )}
          </div>
        </div>
      </Card>

      <Card title="Income">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div>
            <h3 className="mb-3 text-sm text-muted">By category</h3>
            {s.incomeByCategory.length ? (
              <BarRows
                tone="good"
                total={s.income}
                items={s.incomeByCategory.map((c) => ({
                  label: c.label,
                  amount: c.amount,
                  sub: `${c.count} transaction${c.count === 1 ? "" : "s"}`,
                  href: `/finance/transactions?cat=${c.category ?? ""}&m=${month}&kind=income`,
                }))}
              />
            ) : (
              <p className="py-2 text-muted">No income this month.</p>
            )}
          </div>
          <div>
            <h3 className="mb-3 text-sm text-muted">Top sources</h3>
            {s.topIncome.length ? (
              <BarRows
                tone="good"
                items={s.topIncome.map((m) => ({ label: m.name, amount: m.amount, sub: `${m.count} transaction${m.count === 1 ? "" : "s"}` }))}
              />
            ) : (
              <p className="py-2 text-muted">Nothing to show.</p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
