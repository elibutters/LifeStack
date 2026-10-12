import { type Cell, type PacePoint } from "@/lib/workouts-core";
import { fmtMiles, fmtPace, miles } from "@/lib/units";
import { fmtDayShort } from "@/lib/dates";

// Plain SVG, rendered on the server. Hovering shows the browser's own tooltip from <title>.

export function WeeklyBars({ weeks }: { weeks: { weekStart: string; distanceM: number; count: number }[] }) {
  const max = Math.max(...weeks.map((w) => w.distanceM), 1);
  const n = weeks.length;
  const w = 640;
  const col = w / Math.max(n, 1);
  const bar = Math.max(2, col * (n > 40 ? 0.8 : 0.68));
  const h = 150;
  const avg = weeks.reduce((s, x) => s + x.distanceM, 0) / Math.max(n, 1);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h + 16}`} className="w-full text-accent" role="img" aria-label="Miles per week">
        {avg > 0 && <line x1={0} x2={w} y1={h - (avg / max) * h} y2={h - (avg / max) * h} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="3 3" />}
        {weeks.map((x, i) => {
          const bh = x.distanceM > 0 ? Math.max(2, (x.distanceM / max) * h) : 0;
          return (
            <g key={x.weekStart}>
              {bh > 0 && <rect x={i * col} y={h - bh} width={bar} height={bh} rx={1.5} fill="currentColor" opacity={0.9} />}
              <rect x={i * col} y={0} width={col} height={h} fill="transparent">
                <title>{`Week of ${fmtDayShort(x.weekStart)}: ${fmtMiles(x.distanceM)}, ${x.count} workout${x.count === 1 ? "" : "s"}`}</title>
              </rect>
            </g>
          );
        })}
        <text x={0} y={h + 11} fill="var(--color-muted)" fontSize="10">{fmtDayShort(weeks[0]?.weekStart ?? "")}</text>
        <text x={w} y={h + 11} textAnchor="end" fill="var(--color-muted)" fontSize="10">{`max ${miles(max).toFixed(0)} mi`}</text>
      </svg>
    </div>
  );
}

// 12 weeks by 7 days, Monday on top. Darker means farther.
export function Consistency({ cells }: { cells: Cell[] }) {
  if (cells.length === 0) return null;
  const first = cells[0]!.date;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7; // empty slots before the first day
  const slots: (Cell | null)[] = [...Array(lead).fill(null), ...cells];
  const cols = Math.ceil(slots.length / 7);
  const max = Math.max(...cells.map((c) => c.distanceM), 1);
  const size = 12, gap = 3;
  return (
    <svg viewBox={`0 0 ${cols * (size + gap)} ${7 * (size + gap)}`} className="mx-auto w-full max-w-md text-accent" role="img" aria-label="Days with a workout, last 12 weeks">
      {slots.map((c, i) => {
        if (!c) return null;
        const x = Math.floor(i / 7) * (size + gap), y = (i % 7) * (size + gap);
        const level = c.count === 0 ? 0 : 0.35 + 0.65 * Math.min(1, c.distanceM / max);
        return (
          <rect key={c.date} x={x} y={y} width={size} height={size} rx={2.5} fill={c.count ? "currentColor" : "var(--color-raised)"} opacity={c.count ? level : 1}>
            <title>{c.count ? `${fmtDayShort(c.date)}: ${fmtMiles(c.distanceM)}` : `${fmtDayShort(c.date)}: rest`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

// Pace of each run over time; faster is higher.
export function PaceDots({ series }: { series: PacePoint[] }) {
  if (series.length < 2) return <p className="text-sm text-muted">Needs at least two runs of 2 miles or more.</p>;
  const paces = series.map((p) => p.paceSecPerKm);
  const lo = Math.min(...paces), hi = Math.max(...paces);
  const t0 = Date.parse(series[0]!.date), t1 = Date.parse(series.at(-1)!.date);
  const wv = 640, hv = 150, pad = 8;
  const x = (d: string) => pad + (t1 === t0 ? 0.5 : (Date.parse(d) - t0) / (t1 - t0)) * (wv - pad * 2);
  const y = (p: number) => pad + (hi === lo ? 0.5 : (p - lo) / (hi - lo)) * (hv - pad * 2); // faster (smaller) near the top
  const pts = series.map((p) => `${x(p.date).toFixed(1)},${y(p.paceSecPerKm).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${wv} ${hv + 16}`} className="w-full text-accent" role="img" aria-label="Pace per run">
      <polyline points={pts} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.5} />
      {series.map((p) => (
        <circle key={p.date + p.distanceM} cx={x(p.date)} cy={y(p.paceSecPerKm)} r={3.4} fill="currentColor">
          <title>{`${fmtDayShort(p.date)}: ${fmtPace(p.paceSecPerKm)} over ${fmtMiles(p.distanceM)}`}</title>
        </circle>
      ))}
      <text x={0} y={hv + 12} fill="var(--color-muted)" fontSize="10">{fmtDayShort(series[0]!.date)}</text>
      <text x={wv} y={hv + 12} textAnchor="end" fill="var(--color-muted)" fontSize="10">{`${fmtPace(lo)} fastest · ${fmtPace(hi)} slowest`}</text>
    </svg>
  );
}
