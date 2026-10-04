import Link from "next/link";
import { fmtMoney } from "@/lib/finance-calc";

const dayLabel = (d: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${d}T00:00:00Z`));

// Small chart pieces drawn with plain SVG and CSS, so they cost no script and work on any screen.
export function AreaChart({ points, label }: { points: { day: string; value: number }[]; label: string }) {
  if (points.length < 2) return <p className="py-6 text-sm text-muted">History builds up as the days go by.</p>;
  const W = 600;
  const H = 100;
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.12;
  min -= pad;
  max += pad;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / (max - min)) * H;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full text-accent" role="img" aria-label={label}>
        <path d={`${line} L${W} ${H} L0 ${H} Z`} fill="currentColor" opacity="0.12" />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span>{dayLabel(points[0]!.day)}</span>
        <span>{dayLabel(points.at(-1)!.day)}</span>
      </div>
    </div>
  );
}

export type BarItem = { label: string; amount: number; sub?: string; href?: string };

export function BarRows({ items, total, tone = "accent" }: { items: BarItem[]; total?: number; tone?: "accent" | "good" }) {
  const max = Math.max(...items.map((i) => i.amount), 1);
  const bar = tone === "good" ? "bg-emerald-400/70" : "bg-accent/70";
  return (
    <ul className="space-y-3">
      {items.map((i) => {
        const row = (
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate">{i.label}</span>
              <span className="shrink-0 tabular-nums">
                {fmtMoney(i.amount)}
                {total ? <span className="ml-2 text-sm text-muted">{Math.round((i.amount / total) * 100)}%</span> : null}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-sm bg-raised">
              <div className={`h-full rounded-sm ${bar}`} style={{ width: `${Math.max(2, (i.amount / max) * 100)}%` }} />
            </div>
            {i.sub && <p className="mt-1 text-xs text-muted">{i.sub}</p>}
          </div>
        );
        return <li key={i.label}>{i.href ? <Link href={i.href} className="block rounded-md hover:bg-raised/60">{row}</Link> : row}</li>;
      })}
    </ul>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function CashflowColumns({ data, highlight }: { data: { month: string; income: number; spending: number }[]; highlight?: string }) {
  const max = Math.max(...data.flatMap((d) => [d.income, d.spending]), 1);
  return (
    <div>
      <div className="flex h-40 items-end gap-1.5 sm:gap-2">
        {data.map((d) => (
          <div key={d.month} className={`flex h-full flex-1 items-end justify-center gap-0.5 rounded-sm ${d.month === highlight ? "bg-raised/60" : ""}`} title={`${d.month}: ${fmtMoney(d.income)} in, ${fmtMoney(d.spending)} out`}>
            <div className="w-1/2 max-w-3 rounded-t-sm bg-emerald-400/70" style={{ height: `${(d.income / max) * 100}%` }} />
            <div className="w-1/2 max-w-3 rounded-t-sm bg-accent/70" style={{ height: `${(d.spending / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5 sm:gap-2">
        {data.map((d) => (
          <span key={d.month} className="flex-1 text-center text-[11px] text-muted">
            {MONTHS[Number(d.month.slice(5)) - 1]}
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-400/70" />Money in</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-accent/70" />Money out</span>
      </div>
    </div>
  );
}
