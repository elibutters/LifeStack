// Quick capture rules: what can be logged, how it is validated, and how a day is summarised.
// Pure (no database, no server-only imports) so it can be tested on its own.
import { z } from "zod";

export const MOOD_LABELS: Record<number, string> = { 1: "Low", 2: "Meh", 3: "Okay", 4: "Good", 5: "Great" };

// Typical amounts, only used when no amount is given. They are estimates.
export const CAFFEINE_PRESETS = [
  { drink: "Coffee", mg: 95 },
  { drink: "Espresso", mg: 64 },
  { drink: "Cold brew", mg: 150 },
  { drink: "Tea", mg: 47 },
  { drink: "Energy drink", mg: 80 },
  { drink: "Soda", mg: 34 },
] as const;

const shared = {
  // Lets a client retry a request without logging the same thing twice.
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  // When it happened, if not just now.
  at: z.iso.datetime({ offset: true }).optional(),
};

export const EventInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mood"), value: z.number().int().min(1).max(5), note: z.string().trim().max(200).optional(), ...shared }),
  z.object({ type: z.literal("caffeine"), drink: z.string().trim().min(1).max(40).default("Coffee"), mg: z.number().min(0).max(1000).optional(), ...shared }),
  z.object({ type: z.literal("supplement"), name: z.string().trim().min(1).max(60), ...shared }),
]);
export type EventInputT = z.infer<typeof EventInput>;

// log:* are for shortcuts and widgets; the :read scopes below let an agent read each area through MCP.
export const SCOPES = ["log:write", "log:read", "calendar:read", "sleep:read", "finance:read", "amazon:write", "account:read"] as const;
export const AGENT_SCOPES: Scope[] = ["log:write", "log:read", "calendar:read", "sleep:read", "finance:read"];
export type Scope = (typeof SCOPES)[number];
// What the iPhone app's key carries: everything an agent reads, plus the account section.
export const APP_SCOPES: Scope[] = [...AGENT_SCOPES, "account:read"];

// Domain and key each kind of entry is stored under in the shared events table.
export const KEYS = { mood: ["log", "mood"], caffeine: ["log", "caffeine"], supplement: ["supplement", "supplement.taken"] } as const;
export const CAPTURE_KEYS = ["mood", "caffeine", "supplement.taken"] as const;

const FUTURE_SLACK_MS = 5 * 60 * 1000;
const MAX_BACKDATE_MS = 30 * 24 * 60 * 60 * 1000;

export function resolveTime(at: string | undefined, now: Date): { ok: true; ts: Date } | { ok: false; error: string } {
  if (!at) return { ok: true, ts: now };
  const ts = new Date(at);
  if (Number.isNaN(ts.getTime())) return { ok: false, error: "at is not a valid time" };
  if (ts.getTime() > now.getTime() + FUTURE_SLACK_MS) return { ok: false, error: "at is in the future" };
  if (ts.getTime() < now.getTime() - MAX_BACKDATE_MS) return { ok: false, error: "at is more than 30 days ago" };
  return { ok: true, ts };
}

export type LogRow = {
  ts: Date;
  domain: string;
  key: string;
  valueNum: number | null;
  valueText: string | null;
  payload: Record<string, unknown>;
  source: string;
  sourceId: string;
};

export const presetMg = (drink: string) => CAFFEINE_PRESETS.find((p) => p.drink.toLowerCase() === drink.trim().toLowerCase())?.mg ?? null;

export function toRow(input: EventInputT, ts: Date, source: string, sourceId: string): LogRow {
  switch (input.type) {
    case "mood":
      return { ts, domain: "log", key: "mood", valueNum: input.value, valueText: input.note?.trim() || null, payload: {}, source, sourceId };
    case "caffeine": {
      const mg = input.mg ?? presetMg(input.drink);
      return { ts, domain: "log", key: "caffeine", valueNum: mg, valueText: input.drink, payload: { drink: input.drink, estimated: input.mg == null && mg != null }, source, sourceId };
    }
    case "supplement":
      return { ts, domain: "supplement", key: "supplement.taken", valueNum: 1, valueText: input.name, payload: {}, source, sourceId };
  }
}

export type Entry = { id: number; ts: Date; key: string; valueNum: number | null; valueText: string | null; source: string };

export function describeEntry(e: Pick<Entry, "key" | "valueNum" | "valueText">): string {
  if (e.key === "mood") return `Mood ${e.valueNum ?? "?"}${e.valueNum && MOOD_LABELS[e.valueNum] ? ` (${MOOD_LABELS[e.valueNum]})` : ""}${e.valueText ? `: ${e.valueText}` : ""}`;
  if (e.key === "caffeine") return `${e.valueText ?? "Caffeine"}${e.valueNum != null ? ` (${Math.round(e.valueNum)} mg)` : ""}`;
  if (e.key === "supplement.taken") return e.valueText ?? "Supplement";
  return e.key;
}

export type TodaySummary = {
  mood: { value: number; at: Date; count: number } | null;
  caffeine: { count: number; mg: number; lastAt: Date | null };
  supplements: { name: string; count: number; lastAt: Date }[];
};

// `entries` are the day's capture entries, in any order.
export function summarizeToday(entries: Entry[]): TodaySummary {
  const byTime = [...entries].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const moods = byTime.filter((e) => e.key === "mood" && e.valueNum != null);
  const coffee = byTime.filter((e) => e.key === "caffeine");
  const supps = new Map<string, { name: string; count: number; lastAt: Date }>();
  for (const e of byTime) {
    if (e.key !== "supplement.taken") continue;
    const name = e.valueText ?? "Supplement";
    const cur = supps.get(name);
    supps.set(name, { name, count: (cur?.count ?? 0) + 1, lastAt: e.ts });
  }
  const lastMood = moods.at(-1);
  return {
    mood: lastMood ? { value: lastMood.valueNum!, at: lastMood.ts, count: moods.length } : null,
    caffeine: { count: coffee.length, mg: Math.round(coffee.reduce((s, e) => s + (e.valueNum ?? 0), 0)), lastAt: coffee.at(-1)?.ts ?? null },
    supplements: [...supps.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
