import type { Metadata } from "next";
import { Card } from "@/components/card";
import { AreaChart } from "@/components/charts";
import { StatusMark } from "@/components/status-mark";
import { requireSession } from "@/lib/auth";
import { loadCaptureSince, listSupplements } from "@/lib/capture";
import { groupLogDays, logChartPoints, MOOD_LABELS, type Entry } from "@/lib/capture-core";
import { addDays, eachDay, fmtDayLong, startOfDay, todayInTz, ymd } from "@/lib/dates";

export const metadata: Metadata = { title: "Log history" };
export const dynamic = "force-dynamic";

const DAYS = 42;

export default async function History() {
  await requireSession();
  const today = todayInTz();
  const from = addDays(today, -(DAYS - 1));
  const [feed, listed] = await Promise.all([loadCaptureSince(startOfDay(from)).catch(() => null), listSupplements().catch(() => [])]);
  if (!feed) return <p className="text-danger">Couldn't load your log. Try again shortly.</p>;
  if (!feed.length) return <p className="py-6 text-muted">Nothing logged yet. Entries show up here the moment you add them.</p>;

  const days = groupLogDays(feed, (ts) => ymd(ts));
  const span = eachDay(from, today);
  const charts = logChartPoints(days, span);
  const listedN = listed.length;

  return (
    <div className="space-y-4">
      <Card title="Mood" action={<span className="text-xs text-muted">Last log each day</span>}>
        <AreaChart points={charts.mood} label="Mood over time" range={{ min: 1, max: 5 }} />
      </Card>
      <Card title="Caffeine" action={<span className="text-xs text-muted">mg per day</span>}>
        <AreaChart points={charts.caffeine} label="Caffeine over time" />
      </Card>
      <Card title="Supplements" action={<span className="text-xs text-muted">{listedN ? `kinds taken / ${listedN}` : "kinds taken per day"}</span>}>
        <AreaChart points={charts.supplements} label="Supplements over time" range={listedN ? { min: 0, max: listedN } : undefined} />
      </Card>

      <h2 className="pt-2 text-lg font-semibold tracking-tight">By day</h2>
      {days.map((d) => {
        const s = d.summary;
        const taken = new Map(s.supplements.map((x) => [x.name, x]));
        const extras = s.supplements.filter((x) => !listed.some((l) => l.name === x.name));
        const bits = [
          s.mood ? `Mood ${s.mood.value}` : null,
          s.caffeine.count ? `${s.caffeine.mg} mg` : null,
          s.supplements.length ? `${s.supplements.length}${listedN ? `/${listedN}` : ""}` : null,
        ].filter(Boolean);
        return (
          <section key={d.day} className="rounded-md border border-line bg-surface px-4 py-1">
            <header className="flex flex-wrap items-baseline justify-between gap-2 py-3">
              <h3 className="font-medium">{fmtDayLong(d.day)}</h3>
              <p className="text-sm text-muted">{bits.join(" · ")}</p>
            </header>
            <ul className="divide-y divide-line border-t border-line">
              <CheckRow ok={Boolean(s.mood)} label="Mood" detail={s.mood ? `${s.mood.value} (${MOOD_LABELS[s.mood.value]})` : undefined} />
              <CheckRow ok={s.caffeine.count > 0} label="Caffeine" detail={s.caffeine.count ? `${s.caffeine.mg} mg` : undefined} />
              {listed.map((l) => {
                const hit = taken.get(l.name);
                const dose = hit ? doseFor(d.entries, l.name) : null;
                return <CheckRow key={l.name} ok={Boolean(hit)} label={l.name} detail={dose ?? undefined} />;
              })}
              {extras.map((x) => (
                <CheckRow key={x.name} ok label={x.name} detail={doseFor(d.entries, x.name) ?? undefined} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function doseFor(entries: Entry[], name: string): string | null {
  const e = entries.find((x) => x.key === "supplement.taken" && x.valueText === name);
  if (!e || e.valueNum == null) return null;
  return e.unit ? `${e.valueNum} ${e.unit}` : String(e.valueNum);
}

function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <StatusMark ok={ok} choice />
      <span className={`min-w-0 truncate ${ok ? "" : "text-muted"}`}>{label}</span>
      {detail && <span className="ml-auto shrink-0 text-sm text-muted">{detail}</span>}
    </li>
  );
}
