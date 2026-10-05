import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { Card } from "@/components/card";
import { MiniStages, NightBars, NightLine, ScoreRing, StageBar } from "@/components/sleep-viz";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";
import { addDays, eachDay, fmtDayLong, fmtTime, ymd } from "@/lib/dates";
import { getEightConnection, syncEightIfStale } from "@/lib/eight";
import { fmtMinutes, loadNights, mean, type Night } from "@/lib/sleep";

export const metadata: Metadata = { title: "Sleep" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RANGES = [
  { id: "7", days: 7, label: "7d" },
  { id: "14", days: 14, label: "14d" },
  { id: "30", days: 30, label: "30d" },
  { id: "90", days: 90, label: "90d" },
  { id: "all", days: 2500, label: "All" },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

function parseRange(raw: string | undefined) {
  return RANGES.find((r) => r.id === raw) ?? RANGES[1]!;
}

export default async function SleepPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  await requireSession();
  after(syncEightIfStale);
  const range = parseRange((await searchParams).r);
  const [connected, loaded] = await Promise.all([getEightConnection().then((c) => !!c), loadNights(range.days)]);
  const today = ymd(new Date());
  const from = range.id === "all" ? (loaded.at(-1)?.day ?? today) : addDays(today, -(range.days - 1));
  const nights = loaded.filter((n) => n.day >= from && n.day <= today);
  const days = eachDay(from, today);
  const latest = loaded[0];
  const trend = nights;
  const avgLabel = range.id === "all" ? "average" : `${range.id}-day avg`;

  return (
    <>
      <PageHeader>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Sleep</h1>
            {latest?.processing && <p className="mt-1 text-sm text-muted">Still scoring</p>}
          </div>
          <nav aria-label="Time range" className="flex rounded-md border border-line p-0.5">
            {RANGES.map((r) => (
              <Link
                key={r.id}
                href={r.id === "14" ? "/sleep" : `/sleep?r=${r.id}`}
                aria-current={r.id === range.id ? "page" : undefined}
                className={`flex h-9 items-center px-2.5 text-sm ${
                  r.id === range.id ? "rounded-sm bg-raised text-fg" : "text-muted hover:text-fg"
                }`}
              >
                {r.label}
              </Link>
            ))}
          </nav>
        </div>
      </PageHeader>
      <div className="space-y-6">

      {!connected ? (
        <p className="text-muted">
          Eight Sleep is not connected yet.{" "}
          <Link href="/connections" className="text-accent">
            Connect it
          </Link>{" "}
          to pull nightly scores and stages.
        </p>
      ) : loaded.length === 0 ? (
        <p className="text-muted">No nights imported yet. Sync from Connections, or wait for the daily import.</p>
      ) : (
        <>
          {latest && <LastNight night={latest} sample={trend} avgLabel={avgLabel} />}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card
              title={`Score · ${rangeLabel(range.id, days.length)}`}
              action={<span className="text-sm tabular-nums text-fg">Avg {fmtNum(mean(trend.map((n) => n.score)), 0) ?? "—"}</span>}
            >
              <NightBars nights={trend} days={days} field="score" label="Sleep scores" />
            </Card>
            <Card
              title={`Time asleep · ${rangeLabel(range.id, days.length)}`}
              action={<span className="text-sm tabular-nums text-fg">Avg {fmtMinutes(mean(trend.map((n) => n.sleepMin)))}</span>}
            >
              <NightBars nights={trend} days={days} field="sleepMin" label="Time asleep" />
            </Card>
            <Card
              title={`HRV · ${rangeLabel(range.id, days.length)}`}
              action={
                <span className="text-sm tabular-nums text-fg">
                  Avg {trend.some((n) => n.hrv != null) ? `${fmtNum(mean(trend.map((n) => n.hrv)), 0)} ms` : "—"}
                </span>
              }
            >
              <NightLine nights={trend} days={days} field="hrv" label="HRV" />
            </Card>
            <Card
              title={`Breathing · ${rangeLabel(range.id, days.length)}`}
              action={
                <span className="text-sm tabular-nums text-fg">
                  Avg {trend.some((n) => n.respiratoryAvg != null) ? `${fmtNum(mean(trend.map((n) => n.respiratoryAvg)), 1)} / min` : "—"}
                </span>
              }
            >
              <NightLine nights={trend} days={days} field="respiratoryAvg" label="Breathing rate" />
            </Card>
          </div>

          {nights.length > 1 && (
            <Card title="History">
              <ul className="divide-y divide-line">
                {nights.map((n) => (
                  <li key={n.day} className="flex items-center gap-3 py-2.5">
                    <MiniStages night={n} />
                    <span className="min-w-0 flex-1 truncate font-medium">{fmtDayLong(n.day)}</span>
                    <span className="shrink-0 text-sm tabular-nums text-muted">
                      {n.score != null ? Math.round(n.score) : "—"}
                      <span className="mx-1.5 text-line">·</span>
                      {fmtMinutes(n.sleepMin)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
    </>
  );
}

function rangeLabel(id: RangeId, dayCount: number) {
  if (id === "all") return `${dayCount} days`;
  return `${id} days`;
}

function LastNight({ night, sample, avgLabel }: { night: Night; sample: Night[]; avgLabel: string }) {
  const start = night.bedStart ?? night.presenceStart;
  const end = night.bedEnd ?? night.presenceEnd;
  const avgScore = mean(sample.map((n) => n.score));
  const avgSleep = mean(sample.map((n) => n.sleepMin));
  return (
    <Card title="Last night">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        {night.score != null ? <ScoreRing score={night.score} day={night.day} /> : <div className="grid h-28 w-28 place-items-center text-sm text-muted">—</div>}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-2xl font-semibold tracking-tight">{fmtMinutes(night.sleepMin)} asleep</p>
          {start && end && (
            <p className="text-muted">
              {fmtTime(new Date(start))} – {fmtTime(new Date(end))}
              {night.presenceMin != null ? ` · ${fmtMinutes(night.presenceMin)} in bed` : ""}
            </p>
          )}
          <p className="text-sm text-muted">
            {delta(night.score, avgScore, `pts vs ${avgLabel}`)}
            {night.sleepMin != null && avgSleep != null ? ` · ${deltaMin(night.sleepMin, avgSleep)} vs ${avgLabel}` : ""}
          </p>
        </div>
      </div>
      <StageBar night={night} className="mt-5" />
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {night.hrv != null && <Stat label="HRV" value={`${Math.round(night.hrv)} ms`} />}
        {night.respiratoryAvg != null && <Stat label="Breathing" value={`${night.respiratoryAvg.toFixed(1)} / min`} />}
        {night.tnt != null && <Stat label="Toss and turn" value={String(night.tnt)} />}
        {night.tempBedC != null && <Stat label="Bed" value={`${night.tempBedC.toFixed(1)}°C`} />}
      </dl>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function fmtNum(n: number | undefined, digits: number) {
  if (n == null) return undefined;
  return n.toFixed(digits);
}

function delta(now: number | undefined, avg: number | undefined, suffix: string) {
  if (now == null || avg == null) return null;
  const d = Math.round(now - avg);
  if (d === 0) return `Even with ${suffix.replace("pts vs ", "")}`;
  return `${d > 0 ? "+" : ""}${d} ${suffix}`;
}

function deltaMin(now: number, avg: number) {
  const d = Math.round(now - avg);
  if (d === 0) return "even";
  const sign = d > 0 ? "+" : "-";
  return `${sign}${fmtMinutes(Math.abs(d))}`;
}
