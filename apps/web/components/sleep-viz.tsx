"use client";

import { useState } from "react";
import { fmtDayShort } from "@/lib/dates";
import { fmtMinutes, mean, type NightPayload } from "@/lib/eight-map";

type Night = NightPayload;

const STAGES = [
  { key: "deepMin", label: "Deep", className: "bg-sleep-deep" },
  { key: "remMin", label: "REM", className: "bg-sleep-rem" },
  { key: "lightMin", label: "Light", className: "bg-sleep-light" },
  { key: "awakeMin", label: "Awake", className: "bg-sleep-awake" },
] as const;

type Field = "score" | "sleepMin" | "hrv" | "respiratoryAvg";

const FIELDS: Record<Field, { label: string; format: (n: number) => string; read: (n: Night) => number | undefined }> = {
  score: { label: "Score", format: (n) => String(Math.round(n)), read: (n) => n.score },
  sleepMin: { label: "Asleep", format: fmtMinutes, read: (n) => n.sleepMin },
  hrv: { label: "HRV", format: (n) => `${Math.round(n)} ms`, read: (n) => n.hrv },
  respiratoryAvg: { label: "Breathing", format: (n) => `${n.toFixed(1)} / min`, read: (n) => n.respiratoryAvg },
};

function tipText(day: string, value: string) {
  return `${fmtDayShort(day)} · ${value}`;
}

function HoverTip({ text, x, y }: { text: string; x: number; y: number }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-md border border-line bg-raised px-2 py-1 text-xs text-fg shadow-lg"
      style={{ left: x + 12, top: y + 12 }}
    >
      {text}
    </div>
  );
}

function useHoverTip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  return {
    tip,
    show: (text: string, e: { clientX: number; clientY: number }) => setTip({ text, x: e.clientX, y: e.clientY }),
    move: (e: { clientX: number; clientY: number }) => setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t)),
    hide: () => setTip(null),
  };
}

export function ScoreRing({ score, day }: { score: number; day: string }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, score)) / 100;
  const hover = useHoverTip();
  const text = tipText(day, `Score ${Math.round(score)}`);
  return (
    <>
      <svg
        viewBox="0 0 100 100"
        className="h-28 w-28 shrink-0 cursor-default text-fg"
        aria-label={text}
        onMouseEnter={(e) => hover.show(text, e)}
        onMouseMove={hover.move}
        onMouseLeave={hover.hide}
      >
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-line)" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="8"
          strokeDasharray={`${(c * pct).toFixed(2)} ${c.toFixed(2)}`}
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="52" textAnchor="middle" dominantBaseline="middle" fill="currentColor" fontSize="22" fontWeight="600">
          {Math.round(score)}
        </text>
      </svg>
      {hover.tip && <HoverTip {...hover.tip} />}
    </>
  );
}

export function StageBar({ night, className = "" }: { night: Night; className?: string }) {
  const parts = STAGES.map((s) => ({ ...s, min: night[s.key] ?? 0 })).filter((s) => s.min > 0);
  const total = parts.reduce((n, s) => n + s.min, 0);
  const hover = useHoverTip();
  if (total <= 0) return null;
  return (
    <div className={className}>
      <div className="flex h-3 overflow-hidden rounded-sm bg-raised" role="img" aria-label="Sleep stages">
        {parts.map((s) => (
          <div
            key={s.key}
            className={`${s.className} cursor-default`}
            style={{ width: `${(s.min / total) * 100}%` }}
            onMouseEnter={(e) => hover.show(tipText(night.day, `${s.label} ${fmtMinutes(s.min)}`), e)}
            onMouseMove={hover.move}
            onMouseLeave={hover.hide}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {parts.map((s) => (
          <li
            key={s.key}
            className="flex cursor-default items-center gap-1.5"
            onMouseEnter={(e) => hover.show(tipText(night.day, `${s.label} ${fmtMinutes(s.min)}`), e)}
            onMouseMove={hover.move}
            onMouseLeave={hover.hide}
          >
            <span className={`h-1.5 w-1.5 rounded-sm ${s.className}`} />
            {s.label} {fmtMinutes(s.min)}
          </li>
        ))}
      </ul>
      {hover.tip && <HoverTip {...hover.tip} />}
    </div>
  );
}

export function MiniStages({ night }: { night: Night }) {
  const parts = STAGES.map((s) => ({ ...s, min: night[s.key] ?? 0 })).filter((s) => s.min > 0);
  const total = parts.reduce((n, s) => n + s.min, 0);
  const hover = useHoverTip();
  const summary = parts.map((s) => `${s.label} ${fmtMinutes(s.min)}`).join(" · ");
  const text = tipText(night.day, summary || "No stages");
  if (total <= 0) return <span className="block h-1.5 w-16 rounded-sm bg-raised" />;
  return (
    <>
      <span
        className="flex h-1.5 w-16 cursor-default overflow-hidden rounded-sm bg-raised"
        onMouseEnter={(e) => hover.show(text, e)}
        onMouseMove={hover.move}
        onMouseLeave={hover.hide}
      >
        {parts.map((s) => (
          <span key={s.key} className={s.className} style={{ width: `${(s.min / total) * 100}%` }} />
        ))}
      </span>
      {hover.tip && <HoverTip {...hover.tip} />}
    </>
  );
}

function calendarSlots(nights: Night[], days: string[], read: (n: Night) => number | undefined) {
  const byDay = new Map(nights.map((n) => [n.day, n]));
  return days.map((day) => {
    const night = byDay.get(day);
    return { day, v: night ? read(night) : undefined };
  });
}

function lineSegments(slots: { day: string; v: number | undefined }[]) {
  const segs: { i: number; v: number; day: string }[][] = [];
  let cur: { i: number; v: number; day: string }[] = [];
  slots.forEach((s, i) => {
    if (s.v != null) cur.push({ i, v: s.v, day: s.day });
    else if (cur.length) {
      segs.push(cur);
      cur = [];
    }
  });
  if (cur.length) segs.push(cur);
  return segs;
}

export function NightBars({ nights, days, field, label }: { nights: Night[]; days: string[]; field: Field; label: string }) {
  const { read, format } = FIELDS[field];
  const slots = calendarSlots(nights, days, read);
  const present = slots.map((s) => s.v).filter((v): v is number => v != null && v > 0);
  const hover = useHoverTip();
  if (days.length === 0) return null;
  const max = present.length > 0 ? Math.max(...present) : 1;
  const n = days.length;
  const col = n > 40 ? 4 : n > 21 ? 8 : 18;
  const bar = n > 40 ? 3 : n > 21 ? 5 : 10;
  const w = Math.max(n * col, 120);
  const h = 88;
  const showLabels = n <= 14;
  const avg = mean(present);
  const ay = avg == null ? null : h - Math.max(2, (avg / max) * h);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h + (showLabels ? 16 : 0)}`} className="h-28 w-full text-accent" role="img" aria-label={label}>
        {slots.map((s, i) => {
          const x = i * col;
          const missing = s.v == null || s.v <= 0;
          const text = missing ? tipText(s.day, "No data") : tipText(s.day, `${FIELDS[field].label} ${format(s.v!)}`);
          const bh = missing ? 0 : Math.max(2, (s.v! / max) * h);
          const y = h - bh;
          return (
            <g key={s.day}>
              {!missing && <rect x={x} y={y} width={bar} height={bh} fill="currentColor" opacity={0.85} />}
              <rect
                x={x}
                y={0}
                width={col}
                height={h}
                fill="transparent"
                onMouseEnter={(e) => hover.show(text, e)}
                onMouseMove={hover.move}
                onMouseLeave={hover.hide}
              />
              {showLabels && (
                <text x={x + bar / 2} y={h + 12} textAnchor="middle" fill="var(--color-muted)" fontSize="8">
                  {weekday(s.day)}
                </text>
              )}
            </g>
          );
        })}
        {ay != null && <line x1={0} y1={ay} x2={w} y2={ay} stroke="var(--color-muted)" strokeWidth="1" strokeDasharray="4 3" />}
      </svg>
      {hover.tip && <HoverTip {...hover.tip} />}
    </div>
  );
}

export function NightLine({ nights, days, field, label }: { nights: Night[]; days: string[]; field: Field; label: string }) {
  const { read, format } = FIELDS[field];
  const slots = calendarSlots(nights, days, read);
  const segs = lineSegments(slots);
  const pts = segs.flat();
  const hover = useHoverTip();
  if (days.length === 0) return null;
  const max = pts.length > 0 ? Math.max(...pts.map((p) => p.v)) : 1;
  const min = pts.length > 0 ? Math.min(...pts.map((p) => p.v)) : 0;
  const span = Math.max(max - min, 1);
  const w = 240;
  const h = 72;
  const pad = 4;
  const avg = mean(pts.map((p) => p.v));
  const x = (i: number) => pad + (i / Math.max(days.length - 1, 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);
  const col = (w - pad * 2) / Math.max(days.length, 1);
  const ay = avg == null ? null : y(avg);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full overflow-visible text-accent" role="img" aria-label={label}>
        {segs.map((seg, i) =>
          seg.length < 2 ? null : (
            <path
              key={i}
              d={seg.map((p, idx) => `${idx === 0 ? "M" : "L"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
            />
          ),
        )}
        {ay != null && <line x1={pad} y1={ay} x2={w - pad} y2={ay} stroke="var(--color-muted)" strokeWidth="1" strokeDasharray="4 3" />}
        {pts.map((p) => (
          <circle key={p.day} cx={x(p.i)} cy={y(p.v)} r="2.25" fill="currentColor" />
        ))}
        {slots.map((s, i) => {
          const missing = s.v == null;
          const text = missing ? tipText(s.day, "No data") : tipText(s.day, `${FIELDS[field].label} ${format(s.v!)}`);
          return (
            <rect
              key={s.day}
              x={x(i) - col / 2}
              y={0}
              width={col}
              height={h}
              fill="transparent"
              onMouseEnter={(e) => hover.show(text, e)}
              onMouseMove={hover.move}
              onMouseLeave={hover.hide}
            />
          );
        })}
      </svg>
      {hover.tip && <HoverTip {...hover.tip} />}
    </div>
  );
}

function weekday(day: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "narrow", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}
