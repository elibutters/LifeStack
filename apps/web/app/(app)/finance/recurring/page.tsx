import type { Metadata } from "next";
import { Card } from "@/components/card";
import { requireSession } from "@/lib/auth";
import { fmtDayShort } from "@/lib/dates";
import { loadFinance } from "@/lib/finance-data";
import { detectRecurring, fmtMoney } from "@/lib/finance-calc";

export const metadata: Metadata = { title: "Recurring" };
export const dynamic = "force-dynamic";

export default async function Recurring() {
  await requireSession();
  const data = await loadFinance();
  if (!data.ok) return <p className="text-red-300">Couldn't load your finance data. Try again shortly.</p>;
  const list = detectRecurring(data.txns, data.today);
  const monthly = list.reduce((s, r) => s + r.monthlyCost, 0);
  const upcoming = [...list].sort((a, b) => a.nextDate.localeCompare(b.nextDate)).filter((r) => r.nextDate >= data.today).slice(0, 5);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card title="Recurring charges" className="md:col-span-2">
        {list.length ? (
          <>
            <p className="mb-3 text-sm text-muted">
              About {fmtMoney(monthly)} a month ({fmtMoney(monthly * 12)} a year) across {list.length} charges.
            </p>
            <ul className="divide-y divide-line">
              {list.map((r) => (
                <li key={r.name} className="flex items-baseline justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate">{r.name}</p>
                    <p className="text-sm text-muted">
                      {r.cadence} &middot; next around {fmtDayShort(r.nextDate)} &middot; seen {r.count} times
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular-nums">{fmtMoney(r.amount, true)}</p>
                    <p className="text-xs text-muted tabular-nums">{fmtMoney(r.monthlyCost)}/mo</p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="py-2 text-muted">No recurring charges found yet. They show up once a charge has repeated at least three times.</p>
        )}
      </Card>
      <Card title="Coming up">
        {upcoming.length ? (
          <ul className="divide-y divide-line">
            {upcoming.map((r) => (
              <li key={r.name} className="flex items-baseline justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate">{r.name}</p>
                  <p className="text-sm text-muted">{fmtDayShort(r.nextDate)}</p>
                </div>
                <span className="shrink-0 tabular-nums">{fmtMoney(r.amount, true)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-muted">Nothing expected soon.</p>
        )}
        <p className="mt-3 text-xs text-muted">Found by looking for charges that repeat on a regular beat. Dates are estimates.</p>
      </Card>
    </div>
  );
}
