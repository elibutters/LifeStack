import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/card";
import { AreaChart, BarRows } from "@/components/charts";
import { requireSession } from "@/lib/auth";
import { fmtDayShort } from "@/lib/dates";
import { loadFinance } from "@/lib/finance-data";
import { cashPositionHistory, fmtMoney, insights, isLiability, monthOf, netWorth, summarizeMonth } from "@/lib/finance-calc";

export const metadata: Metadata = { title: "Finance" };
export const dynamic = "force-dynamic";

const TONE = { good: "bg-emerald-400", warn: "bg-amber-400", info: "bg-accent" } as const;

export default async function FinanceOverview() {
  await requireSession();
  const data = await loadFinance();
  if (!data.ok) return <p className="text-red-300">Couldn't load your finance data. Try again shortly.</p>;
  const { accounts, txns, liabilities, today } = data;
  if (!accounts.length) {
    return (
      <Card title="Nothing linked yet" className="max-w-2xl">
        <p className="py-2 text-muted">
          Link a bank, card or brokerage and your accounts, spending and net worth will show up here.{" "}
          <Link href="/settings" className="text-accent">Open Settings</Link>
        </p>
      </Card>
    );
  }

  const nw = netWorth(accounts);
  const history = cashPositionHistory(accounts, txns, today, 365);
  const monthAgo = history.at(-31)?.value;
  const nowCash = history.at(-1)?.value;
  const change = monthAgo != null && nowCash != null ? nowCash - monthAgo : null;
  const month = summarizeMonth(txns, monthOf(today));
  const list = insights({ txns, accounts, liabilities, today });
  const due = liabilities
    .filter((l) => l.nextPaymentDue)
    .map((l) => ({ l, acct: accounts.find((a) => a.plaidAccountId === l.accountId) }))
    .filter((x) => x.acct)
    .sort((a, b) => a.l.nextPaymentDue!.localeCompare(b.l.nextPaymentDue!));

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card title="Net worth" className="md:col-span-2">
        <p className="text-4xl font-semibold tabular-nums">{fmtMoney(nw.net)}</p>
        <p className="mt-1 text-sm text-muted">
          Assets {fmtMoney(nw.assets)} &middot; Debts {fmtMoney(nw.liabilities)}
        </p>
        <div className="mt-4">
          <p className="mb-1 text-sm text-muted">
            Cash and cards{nowCash != null ? `: ${fmtMoney(nowCash)}` : ""}
            {change != null && Math.abs(change) >= 1 ? ` (${change >= 0 ? "up" : "down"} ${fmtMoney(Math.abs(change))} in 30 days)` : ""}
          </p>
          <AreaChart points={history} label="Cash and cards over the last year" />
          <p className="mt-2 text-xs text-muted">Rebuilt from your transactions. Investment balances are tracked from the day they were linked.</p>
        </div>
      </Card>

      <Card title="Insights">
        {list.length ? (
          <ul className="space-y-4">
            {list.slice(0, 6).map((i) => (
              <li key={i.id} className="flex gap-3">
                <span aria-hidden="true" className={`mt-2 h-2 w-2 shrink-0 rounded-full ${TONE[i.tone]}`} />
                <div>
                  <p className="font-medium">{i.title}</p>
                  <p className="text-sm text-muted">{i.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-muted">Insights appear once there is a little history to compare.</p>
        )}
      </Card>

      <Card title="Accounts" className="md:col-span-2">
        <div className="space-y-5">
          {nw.groups.map((g) => (
            <div key={g.key}>
              <div className="mb-1 flex items-baseline justify-between">
                <h3 className="text-sm font-medium">{g.label}</h3>
                <span className="tabular-nums">{fmtMoney(g.key === "credit" || g.key === "loans" ? -g.total : g.total)}</span>
              </div>
              <ul className="divide-y divide-line">
                {g.accounts.map((a) => (
                  <li key={a.id} className="flex items-baseline justify-between gap-4 py-2">
                    <div className="min-w-0">
                      <p className="truncate">{a.name}</p>
                      <p className="truncate text-sm text-muted">
                        {a.institution ?? "Linked account"}
                        {a.balanceAt ? ` · updated ${fmtDayShort(a.balanceAt.toISOString().slice(0, 10))}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 tabular-nums">{a.current == null ? "n/a" : fmtMoney(isLiability(a) ? -a.current : a.current, true)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <div className="space-y-4">
        <Card title="This month" action={<Link href="/finance/spending" className="text-sm text-accent">Details</Link>}>
          <dl className="mb-4 grid grid-cols-3 gap-2 text-center">
            <div><dt className="text-xs text-muted">In</dt><dd className="tabular-nums text-emerald-300">{fmtMoney(month.income)}</dd></div>
            <div><dt className="text-xs text-muted">Out</dt><dd className="tabular-nums">{fmtMoney(month.spending)}</dd></div>
            <div><dt className="text-xs text-muted">Net</dt><dd className="tabular-nums">{fmtMoney(month.net)}</dd></div>
          </dl>
          {month.byCategory.length ? (
            <BarRows items={month.byCategory.slice(0, 5).map((c) => ({ label: c.label, amount: c.amount, href: `/finance/transactions?cat=${c.category ?? ""}&m=${month.month}&kind=spending` }))} total={month.spending} />
          ) : (
            <p className="text-sm text-muted">No spending recorded yet this month.</p>
          )}
        </Card>

        {due.length > 0 && (
          <Card title="Card payments">
            <ul className="divide-y divide-line">
              {due.map(({ l, acct }) => (
                <li key={l.accountId} className="flex items-baseline justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate">{acct!.name}</p>
                    <p className={`text-sm ${l.isOverdue ? "text-red-300" : "text-muted"}`}>Due {fmtDayShort(l.nextPaymentDue!)}</p>
                  </div>
                  <span className="shrink-0 tabular-nums">{l.minimumPayment != null ? `min ${fmtMoney(l.minimumPayment, true)}` : ""}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
