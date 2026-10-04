import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { fmtDayShort, isValidMonth } from "@/lib/dates";
import { loadFinance } from "@/lib/finance-data";
import { CATEGORY_KEYS, categoryLabel, classify, fmtMoney, lastMonths, merchantName, monthOf } from "@/lib/finance-calc";

export const metadata: Metadata = { title: "Transactions" };
export const dynamic = "force-dynamic";

const PAGE = 50;
type Params = { q?: string; acct?: string; cat?: string; kind?: string; m?: string; page?: string };
const field = "h-11 w-full rounded-md border border-line bg-surface px-3 text-base outline-none focus:border-accent";

export default async function Transactions({ searchParams }: { searchParams: Promise<Params> }) {
  await requireSession();
  const sp = await searchParams;
  const data = await loadFinance();
  if (!data.ok) return <p className="text-red-300">Couldn't load your finance data. Try again shortly.</p>;
  const { accounts, txns, today } = data;

  const q = (sp.q ?? "").trim().slice(0, 80).toLowerCase();
  const kind = ["spending", "income", "transfer"].includes(sp.kind ?? "") ? sp.kind! : "all";
  const month = isValidMonth(sp.m) ? sp.m : "";
  const acct = accounts.some((a) => a.plaidAccountId === sp.acct) ? sp.acct! : "";
  const cat = sp.cat && (CATEGORY_KEYS.includes(sp.cat) || txns.some((t) => t.category === sp.cat)) ? sp.cat : "";
  const page = Math.max(1, Math.min(500, Number.parseInt(sp.page ?? "1", 10) || 1));

  const rows = txns
    .filter((t) => (!q || `${t.name} ${t.merchant ?? ""}`.toLowerCase().includes(q)) && (!acct || t.accountId === acct) && (!cat || t.category === cat) && (!month || monthOf(t.date) === month) && (kind === "all" || classify(t) === kind))
    .sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const accountName = new Map(accounts.map((a) => [a.plaidAccountId, `${a.name}${a.institution ? ` (${a.institution})` : ""}`]));
  const spent = rows.filter((t) => classify(t) === "spending").reduce((s, t) => s + t.amount, 0);
  const received = rows.filter((t) => classify(t) === "income").reduce((s, t) => s - t.amount, 0);

  const base = new URLSearchParams();
  for (const [k, v] of Object.entries({ q: sp.q?.trim(), acct, cat, kind: kind === "all" ? "" : kind, m: month })) if (v) base.set(k, v);
  const link = (p: number) => `/finance/transactions?${new URLSearchParams({ ...Object.fromEntries(base), page: String(p) })}`;
  const categories = [...new Set([...CATEGORY_KEYS, ...txns.map((t) => t.category).filter((c): c is string => !!c)])];

  const groups: { date: string; items: typeof shown }[] = [];
  for (const t of shown) {
    const last = groups.at(-1);
    if (last?.date === t.date) last.items.push(t);
    else groups.push({ date: t.date, items: [t] });
  }

  return (
    <div className="space-y-4">
      <form method="get" className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search" aria-label="Search" className={`${field} col-span-2`} />
        <select name="m" defaultValue={month} aria-label="Month" className={field}>
          <option value="">All months</option>
          {lastMonths(monthOf(today), 14).reverse().map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select name="acct" defaultValue={acct} aria-label="Account" className={field}>
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.plaidAccountId}>{a.name}</option>)}
        </select>
        <select name="cat" defaultValue={cat} aria-label="Category" className={field}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
        </select>
        <select name="kind" defaultValue={kind} aria-label="Type" className={field}>
          <option value="all">Everything</option>
          <option value="spending">Spending</option>
          <option value="income">Income</option>
          <option value="transfer">Transfers</option>
        </select>
        <div className="col-span-2 flex gap-2 md:col-span-6">
          <button type="submit" className="h-11 rounded-md bg-fg px-4 text-sm font-medium text-bg">Apply</button>
          <Link href="/finance/transactions" className="flex h-11 items-center rounded-md border border-line px-4 text-sm hover:bg-raised">Clear</Link>
          <p className="ml-auto self-center text-sm text-muted">
            {rows.length.toLocaleString()} found &middot; out {fmtMoney(spent)} &middot; in {fmtMoney(received)}
          </p>
        </div>
      </form>

      {groups.length === 0 ? (
        <p className="py-6 text-muted">No transactions match.</p>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.date}>
              <h2 className="mb-1 text-sm font-medium text-muted">{fmtDayShort(g.date)}</h2>
              <ul className="divide-y divide-line rounded-md border border-line bg-surface px-4">
                {g.items.map((t) => {
                  const k = classify(t);
                  const out = t.amount > 0;
                  return (
                    <li key={t.id} className="flex items-baseline justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate">{merchantName(t)}</p>
                        <p className="truncate text-sm text-muted">
                          {k === "transfer" ? "Transfer" : categoryLabel(t.category)} &middot; {accountName.get(t.accountId) ?? "Account"}
                          {t.pending ? " · pending" : ""}
                        </p>
                      </div>
                      <span className={`shrink-0 tabular-nums ${k === "transfer" ? "text-muted" : out ? "" : "text-emerald-300"}`}>
                        {out ? "-" : "+"}{fmtMoney(Math.abs(t.amount), true)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {rows.length > PAGE && (
        <div className="flex items-center justify-between pt-2 text-sm">
          {page > 1 ? <Link href={link(page - 1)} className="rounded-md border border-line px-3 py-2 hover:bg-raised">Newer</Link> : <span />}
          <span className="text-muted">Page {page} of {Math.ceil(rows.length / PAGE)}</span>
          {page * PAGE < rows.length ? <Link href={link(page + 1)} className="rounded-md border border-line px-3 py-2 hover:bg-raised">Older</Link> : <span />}
        </div>
      )}
    </div>
  );
}
