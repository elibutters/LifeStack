"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTxnCategory, setTxnRecurring } from "@/app/(app)/finance/actions";
import { CADENCE_OPTIONS, CATEGORY_KEYS, categoryKey, categoryLabel, titleCase, type RecurringCadence } from "@/lib/finance-calc";

const field = "h-8 max-w-[11rem] rounded-md border border-line bg-surface px-2 text-xs outline-none focus:border-accent";

export function TxnTags({
  id,
  name,
  merchant,
  category,
  detailed,
  cadence,
}: {
  id: string;
  name: string;
  merchant: string | null;
  category: string | null;
  detailed: string | null;
  cadence: RecurringCadence | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const cat = categoryKey({ category, detailed }) ?? "";
  return (
    <div className="flex flex-wrap gap-1.5">
      <select
        aria-label="Category"
        disabled={pending}
        defaultValue={cat}
        className={field}
        onChange={(e) => start(async () => { await setTxnCategory(id, e.target.value || "plaid"); router.refresh(); })}
      >
        <option value="">Uncategorized</option>
        {cat && !CATEGORY_KEYS.includes(cat) && <option value={cat}>{categoryLabel(cat)}</option>}
        {CATEGORY_KEYS.map((c) => (
          <option key={c} value={c}>
            {categoryLabel(c)}
          </option>
        ))}
      </select>
      <select
        aria-label="Recurring"
        disabled={pending}
        defaultValue={cadence ?? "none"}
        className={field}
        onChange={(e) => start(async () => { await setTxnRecurring(id, name, merchant ?? "", e.target.value, category); router.refresh(); })}
      >
        <option value="none">Not Recurring</option>
        {CADENCE_OPTIONS.map((c) => (
          <option key={c} value={c}>
            {titleCase(c)}
          </option>
        ))}
      </select>
    </div>
  );
}
