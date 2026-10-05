"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRightIcon } from "@/components/icons";
import { tagRecurring, untagRecurring } from "@/app/(app)/finance/actions";
import {
  BUCKET_LABEL,
  BUCKET_OPTIONS,
  CADENCE_OPTIONS,
  fmtMoney,
  recurringBuckets,
  titleCase,
  type MerchantChoice,
  type Recurring,
  type RecurringBucket,
  type RecurringCadence,
} from "@/lib/finance-calc";

const pill = "rounded-full border border-line px-2 py-0.5 text-xs";
const field = "h-8 rounded-md border border-line bg-surface px-2 text-xs outline-none focus:border-accent";

export function RecurringBoard({ tagged, merchants }: { tagged: Recurring[]; merchants: MerchantChoice[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({
    rent: false,
    utils: false,
    other: tagged.some((t) => t.bucket === "other"),
  });
  const taggedKeys = new Set(tagged.map((r) => r.key));
  const groups = recurringBuckets(tagged);
  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    return merchants.filter((m) => !taggedKeys.has(m.key) && (m.name.toLowerCase().includes(needle) || m.key.includes(needle))).slice(0, 8);
  }, [merchants, q, taggedKeys]);

  const setTag = (key: string, name: string, cadence: RecurringCadence, bucket: RecurringBucket) =>
    start(async () => {
      await tagRecurring(key, name, cadence, bucket);
      setQ("");
      router.refresh();
    });

  return (
    <div>
      {tagged.length ? (
        <div className="space-y-2">
          {groups.map((g) => (
            <details
              key={g.id}
              open={open[g.id] ?? false}
              onToggle={(e) => setOpen((s) => ({ ...s, [g.id]: e.currentTarget.open }))}
              className="group rounded-md border border-line"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 marker:content-none [&::-webkit-details-marker]:hidden">
                <ChevronRightIcon width={16} height={16} className="shrink-0 text-muted transition-transform group-open:rotate-90" />
                <span className="text-base font-semibold tracking-tight">{g.label}</span>
                <span className="ml-auto tabular-nums text-sm text-muted">{fmtMoney(g.total)}/mo</span>
              </summary>
              {g.items.length ? (
                <ul className="ml-5 divide-y divide-line border-l border-line">
                  {g.items.map((r) => (
                    <li key={r.key} className="flex items-start justify-between gap-4 py-3 pl-3 pr-3">
                      <div className="min-w-0">
                        <p className="flex min-w-0 items-baseline gap-2">
                          <span className="truncate">{r.name}</span>
                          <span className="shrink-0 text-sm text-muted">
                            {r.count}x{r.on ? ` · ${r.on}` : ""}
                          </span>
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <select
                            aria-label={`${r.name} group`}
                            disabled={pending}
                            value={r.bucket}
                            className={field}
                            onChange={(e) => setTag(r.key, r.name, r.cadence, e.target.value as RecurringBucket)}
                          >
                            {BUCKET_OPTIONS.map((b) => (
                              <option key={b} value={b}>
                                {BUCKET_LABEL[b]}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label={`${r.name} frequency`}
                            disabled={pending}
                            value={r.cadence}
                            className={field}
                            onChange={(e) => setTag(r.key, r.name, e.target.value as RecurringCadence, r.bucket)}
                          >
                            {CADENCE_OPTIONS.map((c) => (
                              <option key={c} value={c}>
                                {titleCase(c)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <div className="text-right">
                          <p className="tabular-nums">{fmtMoney(r.amount, true)}</p>
                          {r.cadence !== "monthly" && <p className="text-xs text-muted tabular-nums">{fmtMoney(r.monthlyCost)}/mo</p>}
                        </div>
                        <button
                          type="button"
                          disabled={pending}
                          aria-label={`Remove ${r.name}`}
                          onClick={() => start(async () => { await untagRecurring(r.key); router.refresh(); })}
                          className="h-5 cursor-pointer rounded px-1 text-[11px] leading-none text-danger hover:bg-raised disabled:cursor-not-allowed"
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ml-5 border-l border-line py-2 pl-3 text-sm text-muted">Nothing in this group yet.</p>
              )}
            </details>
          ))}
        </div>
      ) : (
        <p className="py-2 text-muted">Nothing tagged yet. Search a merchant below and put it in Rent, Utilities or Other.</p>
      )}

      <div className="mt-4 border-t border-line pt-4">
        <label className="text-sm text-muted" htmlFor="recurring-search">
          Add a charge
        </label>
        <input
          id="recurring-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search merchants"
          className="mt-1 h-11 w-full rounded-md border border-line bg-surface px-3 text-base outline-none focus:border-accent"
        />
        {hits.length > 0 && (
          <ul className="mt-2 divide-y divide-line rounded-md border border-line">
            {hits.map((m) => (
              <li key={m.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate">{m.name}</p>
                  <p className="text-xs text-muted">
                    {fmtMoney(m.lastAmount, true)} · {m.count}x
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {BUCKET_OPTIONS.map((b) => (
                    <button key={b} type="button" disabled={pending} onClick={() => setTag(m.key, m.name, "monthly", b)} className={pill}>
                      {BUCKET_LABEL[b]}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        {q.trim().length >= 2 && !hits.length && <p className="mt-2 text-sm text-muted">No unmatched merchants with that name.</p>}
      </div>
    </div>
  );
}
