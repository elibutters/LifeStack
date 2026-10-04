import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/card";
import { BarRows, CashflowColumns } from "@/components/charts";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { requireSession } from "@/lib/auth";
import { fmtMonth, isValidMonth } from "@/lib/dates";
import { loadFinance } from "@/lib/finance-data";
import { cashflowSeries, fmtMoney, fmtPct, lastMonths, monthOf, shiftMonthKey, summarizeMonth } from "@/lib/finance-calc";

export const metadata: Metadata = { title: "Spending" };
export const dynamic = "force-dynamic";

const arrow = "grid h-11 w-11 place-items-center rounded-md text-muted hover:bg-raised hover:text-fg";

export default async function Spending({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const data = await loadFinance();
  if (!data.ok) return <p className="text-red-300">Couldn't load your finance data. Try again shortly.</p>;
  const thisMonth = monthOf(data.today);
  const month = isValidMonth(sp.m) && sp.m <= thisMonth ? sp.m : thisMonth;
  const s = summarizeMonth(data.txns, month);
  const prev = summarizeMonth(data.txns, shiftMonthKey(month, -1));
  const flow = cashflowSeries(data.txns, lastMonths(month, 12));
  const delta = prev.spending > 0 ? (s.spending - prev.spending) / prev.spending : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="mr-auto text-xl font-semibold tracking-tight">{fmtMonth(month)}</h2>
        <Link href={`/finance/spending?m=${shiftMonthKey(month, -1)}`} aria-label="Previous month" className={arrow}><ChevronLeftIcon /></Link>
        {month < thisMonth ? (
          <Link href={`/finance/spending?m=${shiftMonthKey(month, 1)}`} aria-label="Next month" className={arrow}><ChevronRightIcon /></Link>
        ) : (
          <span className={`${arrow} opacity-30`} aria-hidden="true"><ChevronRightIcon /></span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Money in", value: fmtMoney(s.income), tone: "text-emerald-300" },
          { label: "Spending", value: fmtMoney(s.spending), tone: "", sub: delta != null ? `${delta >= 0 ? "up" : "down"} ${fmtPct(Math.abs(delta))} vs last month` : undefined },
          { label: "Left over", value: fmtMoney(s.net), tone: s.net < 0 ? "text-red-300" : "" },
          { label: "Savings rate", value: s.savingsRate == null ? "n/a" : fmtPct(s.savingsRate), tone: "" },
        ].map((t) => (
          <div key={t.label} className="rounded-md border border-line bg-surface p-4">
            <p className="text-sm text-muted">{t.label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${t.tone}`}>{t.value}</p>
            {t.sub && <p className="mt-0.5 text-xs text-muted">{t.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="By category">
          {s.byCategory.length ? (
            <BarRows
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
        </Card>
        <Card title="Top merchants">
          {s.topMerchants.length ? (
            <BarRows items={s.topMerchants.map((m) => ({ label: m.name, amount: m.amount, sub: `${m.count} transaction${m.count === 1 ? "" : "s"}` }))} />
          ) : (
            <p className="py-2 text-muted">Nothing to show.</p>
          )}
        </Card>
      </div>

      <Card title="Money in and out, last 12 months">
        <CashflowColumns data={flow} highlight={month} />
        <p className="mt-3 text-xs text-muted">Transfers between your accounts and credit card payments are left out so nothing is counted twice.</p>
      </Card>
    </div>
  );
}
