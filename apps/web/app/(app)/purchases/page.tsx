import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/card";
import { requireSession } from "@/lib/auth";
import { loadAmazon } from "@/lib/amazon";
import { LOGIN_REQUIRED } from "@/lib/amazon-map";
import { fmtDateTime } from "@/lib/dates";

export const metadata: Metadata = { title: "Purchases" };
export const dynamic = "force-dynamic";

const money = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export default async function PurchasesPage() {
  await requireSession();
  const { state, orders, cart } = await loadAmazon();
  const needsLogin = state?.lastError === LOGIN_REQUIRED;
  const grouped = new Map<string, typeof orders>();
  for (const item of orders) {
    const id = item.orderId ?? item.sourceId;
    const list = grouped.get(id) ?? [];
    list.push(item);
    grouped.set(id, list);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Purchases</h1>
          <p className="mt-1 text-sm text-muted">
            {state?.lastOkAt ? `Last snapshot ${fmtDateTime(state.lastOkAt)}` : "No Amazon snapshot yet."}
          </p>
        </div>
        <Link href="/connections" className="text-sm text-accent">
          Connections
        </Link>
      </div>

      {needsLogin && <p className="rounded-md border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-300">{LOGIN_REQUIRED}</p>}

      <Card title="Cart">
        {cart.length ? (
          <ul className="divide-y divide-line">
            {cart.map((item) => (
              <li key={item.sourceId} className="flex items-baseline justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate">{item.title}</p>
                  <p className="text-sm text-muted">
                    Qty {item.quantity}
                    {item.asin ? ` · ${item.asin}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-sm">{money(item.amount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-muted">Cart is empty, or the worker has not sent it yet.</p>
        )}
      </Card>

      <Card title="Recent orders">
        {grouped.size ? (
          <ul className="space-y-5">
            {[...grouped.entries()].map(([id, items]) => (
              <li key={id}>
                <p className="text-sm text-muted">
                  {fmtDateTime(items[0]!.ts)}
                  {items[0]?.status ? ` · ${items[0].status}` : ""} · {id}
                </p>
                <ul className="mt-1 divide-y divide-line">
                  {items.map((item) => (
                    <li key={item.sourceId} className="flex items-baseline justify-between gap-4 py-2">
                      <div className="min-w-0">
                        <p className="truncate">{item.title}</p>
                        <p className="text-sm text-muted">
                          Qty {item.quantity}
                          {item.asin ? ` · ${item.asin}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm">{money(item.amount)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-muted">
            No orders stored yet. Set up the worker on the second laptop, then they will show up here.
          </p>
        )}
      </Card>
    </div>
  );
}
