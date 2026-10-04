import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/card";
import { BarRows } from "@/components/charts";
import { requireSession } from "@/lib/auth";
import { loadAccounts, loadHoldings } from "@/lib/finance-data";
import { fmtMoney, fmtPct, accountLabel } from "@/lib/finance-calc";

export const metadata: Metadata = { title: "Investments" };
export const dynamic = "force-dynamic";

const title = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const TYPES: Record<string, string> = { etf: "ETFs", equity: "Stocks", "mutual fund": "Mutual funds", "fixed income": "Bonds", cash: "Cash", cryptocurrency: "Crypto", derivative: "Options and derivatives", other: "Other" };
const typeLabel = (t: string) => TYPES[t] ?? title(t);

export default async function Investments() {
  await requireSession();
  const [accounts, holdings] = await Promise.all([loadAccounts().catch(() => null), loadHoldings().catch(() => null)]);
  if (!accounts || !holdings) return <p className="text-red-300">Couldn't load your investments. Try again shortly.</p>;
  const invAccounts = accounts.filter((a) => a.type === "investment");
  if (!invAccounts.length) {
    return (
      <Card title="No investment accounts" className="max-w-2xl">
        <p className="py-2 text-muted">Link a brokerage or retirement account in <Link href="/settings" className="text-accent">Settings</Link> and its holdings appear here.</p>
      </Card>
    );
  }

  const total = invAccounts.reduce((s, a) => s + (a.current ?? 0), 0);
  const held = holdings.reduce((s, h) => s + h.value, 0);
  const cost = holdings.reduce((s, h) => s + (h.costBasis ?? 0), 0);
  const withCost = holdings.filter((h) => h.costBasis != null && h.costBasis > 0);
  const gain = withCost.reduce((s, h) => s + h.value - (h.costBasis ?? 0), 0);
  const gainBase = withCost.reduce((s, h) => s + (h.costBasis ?? 0), 0);
  const byType = new Map<string, number>();
  for (const h of holdings) byType.set(h.securityType ?? "other", (byType.get(h.securityType ?? "other") ?? 0) + h.value);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-md border border-line bg-surface p-4"><p className="text-sm text-muted">Total value</p><p className="mt-1 text-2xl font-semibold tabular-nums">{fmtMoney(total)}</p></div>
        <div className="rounded-md border border-line bg-surface p-4"><p className="text-sm text-muted">In holdings</p><p className="mt-1 text-2xl font-semibold tabular-nums">{holdings.length ? fmtMoney(held) : "n/a"}</p></div>
        <div className="rounded-md border border-line bg-surface p-4"><p className="text-sm text-muted">Cost basis</p><p className="mt-1 text-2xl font-semibold tabular-nums">{cost > 0 ? fmtMoney(cost) : "n/a"}</p></div>
        <div className="rounded-md border border-line bg-surface p-4">
          <p className="text-sm text-muted">Gain or loss</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${gain < 0 ? "text-red-300" : gain > 0 ? "text-emerald-300" : ""}`}>{gainBase > 0 ? fmtMoney(gain) : "n/a"}</p>
          {gainBase > 0 && <p className="text-xs text-muted">{fmtPct(gain / gainBase)} on positions with a known cost</p>}
        </div>
      </div>

      {holdings.length === 0 && (
        <Card title="Holdings are not available yet">
          <p className="py-2 text-muted">
            Balances are syncing, but the brokerages have not shared what you hold. In <Link href="/settings" className="text-accent">Settings</Link>, use{" "}
            <strong className="text-fg">Allow investment data</strong> on each brokerage, then sync.
          </p>
        </Card>
      )}

      {byType.size > 0 && (
        <Card title="Allocation">
          <BarRows total={held} items={[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, v]) => ({ label: typeLabel(t), amount: v }))} />
        </Card>
      )}

      {invAccounts.map((a) => {
        const list = holdings.filter((h) => h.accountId === a.plaidAccountId);
        return (
          <Card key={a.id} title={`${accountLabel(a)}${a.institution ? ` · ${a.institution}` : ""}`} action={<span className="tabular-nums">{a.current != null ? fmtMoney(a.current) : "n/a"}</span>}>
            {list.length ? (
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr><th className="py-2 pr-3 font-normal">Holding</th><th className="px-3 text-right font-normal">Shares</th><th className="px-3 text-right font-normal">Price</th><th className="px-3 text-right font-normal">Value</th><th className="pl-3 text-right font-normal">Gain or loss</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {list.map((h, i) => {
                      const g = h.costBasis != null && h.costBasis > 0 ? h.value - h.costBasis : null;
                      return (
                        <tr key={`${h.symbol ?? h.name}-${i}`}>
                          <td className="py-2 pr-3"><p>{h.symbol ?? h.name ?? "Holding"}</p>{h.symbol && h.name && <p className="max-w-[16rem] truncate text-xs text-muted">{h.name}</p>}</td>
                          <td className="px-3 text-right tabular-nums">{h.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                          <td className="px-3 text-right tabular-nums">{fmtMoney(h.price, true)}</td>
                          <td className="px-3 text-right tabular-nums">{fmtMoney(h.value)}</td>
                          <td className={`pl-3 text-right tabular-nums ${g == null ? "text-muted" : g < 0 ? "text-red-300" : "text-emerald-300"}`}>{g == null ? "n/a" : `${fmtMoney(g)} (${fmtPct(g / h.costBasis!)})`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-2 text-sm text-muted">No holdings listed for this account yet.</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
