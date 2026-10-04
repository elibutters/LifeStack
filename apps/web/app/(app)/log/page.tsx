import type { Metadata } from "next";
import { Card } from "@/components/card";
import { QuickLog } from "@/components/quick-log";
import { requireSession } from "@/lib/auth";
import { listSupplements, loadToday } from "@/lib/capture";
import { MOOD_LABELS } from "@/lib/capture-core";
import { fmtTime } from "@/lib/dates";

export const metadata: Metadata = { title: "Log" };
export const dynamic = "force-dynamic";

export default async function QuickLogPage() {
  await requireSession();
  const [today, supplements] = await Promise.all([loadToday().catch(() => null), listSupplements().catch(() => null)]);
  if (!today || !supplements) return <p className="text-red-300">Couldn't load your log. Try again shortly.</p>;
  const { mood, caffeine, supplements: taken } = today.summary;

  return (
    <div className="space-y-4">
      <Card title="Today">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">Mood</dt>
            <dd>{mood ? `${mood.value} (${MOOD_LABELS[mood.value]}) at ${fmtTime(mood.at)}` : "Not logged"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Caffeine</dt>
            <dd>{caffeine.count ? `${caffeine.count} drink${caffeine.count === 1 ? "" : "s"}, ${caffeine.mg} mg${caffeine.lastAt ? `, last at ${fmtTime(caffeine.lastAt)}` : ""}` : "None yet"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Supplements</dt>
            <dd>{taken.length ? taken.map((s) => `${s.name}${s.count > 1 ? ` x${s.count}` : ""}`).join(", ") : "None yet"}</dd>
          </div>
        </dl>
      </Card>
      <QuickLog
        supplements={supplements.map((s) => ({ id: s.id, name: s.name, dose: s.dose, unit: s.unit === "g" ? ("g" as const) : ("mg" as const) }))}
        taken={taken.map((s) => s.name)}
        caffeine={today.entries.filter((e) => e.key === "caffeine").map((e) => ({ id: e.id, drink: e.valueText ?? "Caffeine" }))}
      />
    </div>
  );
}
