import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { Consistency, PaceDots, WeeklyBars } from "@/components/workouts-viz";
import { requireSession } from "@/lib/auth";
import { fmtDayLong, todayInTz } from "@/lib/dates";
import { getConnection, syncStravaIfStale } from "@/lib/strava-sync";
import { fmtDuration, fmtFeet, fmtMiles, fmtPace } from "@/lib/units";
import { loadWorkouts } from "@/lib/workouts";
import { addDaysStr, overviewOf, type Totals, type Workout } from "@/lib/workouts-core";

export const metadata: Metadata = { title: "Workouts" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RANGES = [
  { id: "8", weeks: 8, label: "8w" },
  { id: "26", weeks: 26, label: "6mo" },
  { id: "52", weeks: 52, label: "1y" },
  { id: "all", weeks: 260, label: "All" },
] as const;
const parseRange = (raw: string | undefined) => RANGES.find((r) => r.id === raw) ?? RANGES[0]!;

export default async function WorkoutsPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  await requireSession();
  after(syncStravaIfStale);
  const range = parseRange((await searchParams).r);
  const [connected, all] = await Promise.all([getConnection().then((c) => !!c), loadWorkouts()]);
  const today = todayInTz();
  const ov = overviewOf(all, today, range.weeks, 0);
  const since = range.id === "all" ? "0000-01-01" : addDaysStr(ov.weeks[0]?.weekStart ?? today, 0);
  const list = all.filter((w) => w.date >= since).sort((a, b) => (a.start < b.start ? 1 : -1));
  const inRange = overviewOf(list, today, range.weeks, 0).totals.all;

  return (
    <>
      <PageHeader>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Workouts</h1>
          <nav aria-label="Time range" className="flex rounded-md border border-line p-0.5">
            {RANGES.map((r) => (
              <Link
                key={r.id}
                href={r.id === "8" ? "/workouts" : `/workouts?r=${r.id}`}
                aria-current={r.id === range.id ? "page" : undefined}
                className={`flex h-9 items-center px-2.5 text-sm ${r.id === range.id ? "rounded-sm bg-raised text-fg" : "text-muted hover:text-fg"}`}
              >
                {r.label}
              </Link>
            ))}
          </nav>
        </div>
      </PageHeader>

      {!connected ? (
        <p className="text-muted">
          Strava is not connected yet.{" "}
          <Link href="/connections" className="text-accent">
            Connect it
          </Link>{" "}
          to see your runs and rides here.
        </p>
      ) : all.length === 0 ? (
        <p className="text-muted">No workouts imported yet. Sync from Connections, or give the first import a minute.</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Last 7 days" t={ov.totals.last7} />
            <Stat label="Last 28 days" t={ov.totals.last28} />
            <Stat label="This year" t={ov.totals.ytd} />
            <Stat label="All time" t={ov.totals.all} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Miles per week" action={<span className="text-sm tabular-nums text-fg">{inRange.count} workouts · {fmtMiles(inRange.distanceM, 0)}</span>}>
              <WeeklyBars weeks={ov.weeks} />
            </Card>
            <Card title="Consistency" action={<span className="text-sm text-muted">{ov.streakWeeks} week{ov.streakWeeks === 1 ? "" : "s"} in a row</span>}>
              <Consistency cells={ov.heatmap} />
            </Card>
            <Card title="Pace per run">
              <PaceDots series={ov.pace.filter((p) => p.date >= since)} />
            </Card>
            <Card title="Records">
              <dl className="divide-y divide-line">
                <Record label="Longest run" r={ov.records.longest} value={ov.records.longest ? fmtMiles(ov.records.longest.distanceM) : "–"} />
                <Record label="Fastest pace (2 mi+)" r={ov.records.fastest} value={ov.records.fastest ? fmtPace(ov.records.fastest.paceSecPerKm) : "–"} />
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-muted">Biggest week</dt>
                  <dd className="tabular-nums">{ov.records.biggestWeek ? `${fmtMiles(ov.records.biggestWeek.distanceM)} · week of ${fmtDayLong(ov.records.biggestWeek.period)}` : "–"}</dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-muted">Biggest month</dt>
                  <dd className="tabular-nums">{ov.records.biggestMonth ? `${fmtMiles(ov.records.biggestMonth.distanceM, 0)} · ${ov.records.biggestMonth.period}` : "–"}</dd>
                </div>
              </dl>
            </Card>
          </div>

          {ov.sports.length > 1 && (
            <Card title="By sport">
              <ul className="divide-y divide-line">
                {ov.sports.map((s) => (
                  <li key={s.sport} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="font-medium">{s.sport}</span>
                    <span className="text-sm tabular-nums text-muted">{s.count} · {fmtMiles(s.distanceM, 0)} · {fmtDuration(s.movingS)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title={`Activities · ${list.length}`}>
            <ul className="divide-y divide-line">
              {list.slice(0, 200).map((w) => (
                <li key={w.id ?? w.start} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{w.name ?? w.sport}</p>
                    <p className="truncate text-sm text-muted">{fmtDayLong(w.date)} · {w.sport}</p>
                  </div>
                  <Metrics w={w} />
                </li>
              ))}
            </ul>
            {list.length > 200 && <p className="pt-3 text-sm text-muted">Showing the newest 200.</p>}
          </Card>
        </div>
      )}
    </>
  );
}

function Stat({ label, t }: { label: string; t: Totals }) {
  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{fmtMiles(t.distanceM, t.distanceM >= 100 * 1609 ? 0 : 1)}</p>
      <p className="mt-0.5 text-sm tabular-nums text-muted">
        {t.count} workout{t.count === 1 ? "" : "s"} · {fmtDuration(t.movingS)}
      </p>
      <p className="text-sm tabular-nums text-muted">{t.paceSecPerKm ? `${fmtPace(t.paceSecPerKm)} avg` : "\u00a0"}</p>
    </div>
  );
}

function Record({ label, r, value }: { label: string; r: { date: string; name: string | null } | null; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right tabular-nums">
        {value}
        {r && <span className="block truncate text-xs text-muted">{r.name ?? ""} {fmtDayLong(r.date)}</span>}
      </dd>
    </div>
  );
}

function Metrics({ w }: { w: Workout }) {
  const pace = w.distanceM > 0 && w.movingS > 0 ? Math.round(w.movingS / (w.distanceM / 1000)) : null;
  return (
    <div className="shrink-0 text-right text-sm tabular-nums">
      <p className="font-medium">{fmtMiles(w.distanceM, 2)}</p>
      <p className="text-muted">
        {fmtDuration(w.movingS)}
        {pace && w.sport.includes("Run") ? ` · ${fmtPace(pace)}` : ""}
        {w.elevationM > 0 ? ` · ${fmtFeet(w.elevationM)}` : ""}
        {w.avgHr ? ` · ${Math.round(w.avgHr)} bpm` : ""}
      </p>
    </div>
  );
}
