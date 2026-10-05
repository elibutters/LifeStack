"use client";

import { useState } from "react";
import { fmtDayShort, fmtMonth } from "@/lib/dates";
import { fmtMoney, type MonthSubs, type SubMonthHit } from "@/lib/finance-calc";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

export function RecurringMonths({
  track,
  byMonth,
  current,
}: {
  track: MonthSubs[];
  byMonth: Record<string, SubMonthHit[]>;
  current: string;
}) {
  const [month, setMonth] = useState(current);
  const max = Math.max(...track.flatMap((d) => [d.budget, d.cash]), 1);
  const hits = byMonth[month] ?? [];
  const posted = hits.reduce((s, h) => s + h.posted, 0);

  return (
    <div>
      <p className="mb-3 text-sm text-muted">Tap a month to see what actually posted for each tagged charge.</p>
      <div className="flex h-40 items-end gap-1.5 sm:gap-2">
        {track.map((d) => (
          <button
            key={d.month}
            type="button"
            onClick={() => setMonth(d.month)}
            className={`flex h-full flex-1 items-end justify-center gap-0.5 rounded-sm ${d.month === month ? "bg-raised" : "hover:bg-raised/50"}`}
            aria-label={`${fmtMonth(d.month)}: budget ${fmtMoney(d.budget)}, charged ${fmtMoney(d.cash)}`}
            aria-pressed={d.month === month}
          >
            <div className="w-1/2 max-w-3 rounded-t-sm bg-fg/25" style={{ height: `${(d.budget / max) * 100}%` }} />
            <div className="w-1/2 max-w-3 rounded-t-sm bg-accent/70" style={{ height: `${(d.cash / max) * 100}%` }} />
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5 sm:gap-2">
        {track.map((d) => (
          <span key={d.month} className={`flex-1 text-center text-[11px] ${d.month === month ? "text-fg" : "text-muted"}`}>
            {MONTHS[Number(d.month.slice(5)) - 1]}
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-fg/25" />Budgeted</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-accent/70" />Charged</span>
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <p className="mb-2 text-sm font-medium">
          {fmtMonth(month)}
          <span className="ml-2 font-normal text-muted">
            budgeted {fmtMoney(track.find((d) => d.month === month)?.budget ?? 0)} · posted {fmtMoney(posted)}
          </span>
        </p>
        {hits.length ? (
          <ul className="divide-y divide-line">
            {hits.map((h) => (
              <li key={h.key} className="py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate">{h.name}</span>
                  <span className="shrink-0 tabular-nums">{h.txns.length ? fmtMoney(h.posted, true) : "—"}</span>
                </div>
                {h.txns.length ? (
                  <ul className="mt-1 space-y-0.5 pl-3 text-sm text-muted">
                    {h.txns.map((t, i) => (
                      <li key={`${t.date}-${i}`} className="flex justify-between gap-3">
                        <span>{fmtDayShort(t.date)}</span>
                        <span className="tabular-nums">{fmtMoney(t.amount, true)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-0.5 pl-3 text-sm text-muted">Nothing posted</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No tagged charges yet.</p>
        )}
      </div>
    </div>
  );
}