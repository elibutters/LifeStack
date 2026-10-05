import type { Metadata } from "next";
import { Card } from "@/components/card";
import { RecurringMonths } from "@/components/recurring-months";
import { RecurringBoard } from "@/components/recurring-board";
import { requireSession } from "@/lib/auth";
import { loadFinance } from "@/lib/finance-data";
import { fmtMoney, lastMonths, merchantChoices, monthOf, subscriptionMonthHits, subscriptionTrack, taggedRecurring } from "@/lib/finance-calc";
import { loadRecurringTags } from "@/lib/recurring";

export const metadata: Metadata = { title: "Recurring" };
export const dynamic = "force-dynamic";

export default async function Recurring() {
  await requireSession();
  const data = await loadFinance();
  if (!data.ok) return <p className="text-danger">Couldn't load your finance data. Try again shortly.</p>;
  const tags = await loadRecurringTags().catch(() => []);
  const list = taggedRecurring(data.txns, tags, data.today);
  const monthly = list.reduce((s, r) => s + r.monthlyCost, 0);
  const months = lastMonths(monthOf(data.today), 12);
  const track = subscriptionTrack(list, data.txns, months);
  const byMonth = Object.fromEntries(months.map((m) => [m, subscriptionMonthHits(list, data.txns, m)]));

  return (
    <div className="space-y-4">
      <Card title="Recurring charges">
        <p className="mb-3 text-sm text-muted">
          You pick what counts. Yearly dues are still spread across the year in the monthly total.
          {list.length ? ` About ${fmtMoney(monthly)} a month (${fmtMoney(monthly * 12)} a year).` : ""}
        </p>
        <RecurringBoard tagged={list} merchants={merchantChoices(data.txns)} />
      </Card>
      <Card title="Month by month">
        {list.length ? (
          <RecurringMonths track={track} byMonth={byMonth} current={monthOf(data.today)} />
        ) : (
          <p className="py-2 text-muted">A month-by-month track shows up once you tag charges.</p>
        )}
      </Card>
    </div>
  );
}
