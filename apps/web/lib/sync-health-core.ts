// Pure rules for "is each source still syncing?", no database. Every source is expected to succeed at least once a day (a daily cron plus a
// sync whenever the app is opened), so a source that has not succeeded for more than 30 hours is stale, whatever else it reports.
export const STALE_AFTER_HOURS = 30;

export type SourceInput = {
  key: string;
  label: string;
  lastOkAt: Date | null; // when it last finished a good run
  lastError: string | null; // what it reported on its last failed run, cleared by the next good one
};

export type Health = "ok" | "warning" | "stale" | "failing" | "never";
export type SourceHealth = { key: string; label: string; health: Health; lastOkAt: string | null; ageHours: number | null; message: string | null };

const ago = (hours: number): string => (hours < 1 ? "less than an hour" : hours < 48 ? `${Math.round(hours)} hours` : `${Math.round(hours / 24)} days`);

export function checkSource(s: SourceInput, now: Date): SourceHealth {
  const age = s.lastOkAt ? (now.getTime() - s.lastOkAt.getTime()) / 3_600_000 : null;
  const base = { key: s.key, label: s.label, lastOkAt: s.lastOkAt?.toISOString() ?? null, ageHours: age === null ? null : Math.round(age * 10) / 10 };
  if (age === null) return { ...base, health: "never", message: s.lastError ?? `${s.label} is connected but has never synced.` };
  const stale = age > STALE_AFTER_HOURS;
  if (stale && s.lastError) return { ...base, health: "failing", message: `${s.label} has not synced for ${ago(age)}: ${s.lastError}` };
  if (stale) return { ...base, health: "stale", message: `${s.label} has not synced for ${ago(age)}.` };
  if (s.lastError) return { ...base, health: "warning", message: s.lastError };
  return { ...base, health: "ok", message: null };
}

// Everything that needs a look, worst first, and how many sources are not simply fine.
export function checkAll(sources: SourceInput[], now: Date): { sources: SourceHealth[]; problems: number } {
  const rank: Record<Health, number> = { failing: 0, stale: 1, never: 2, warning: 3, ok: 4 };
  const out = sources.map((s) => checkSource(s, now)).sort((a, b) => rank[a.health] - rank[b.health] || a.label.localeCompare(b.label));
  return { sources: out, problems: out.filter((s) => s.health !== "ok" && s.health !== "warning").length };
}
