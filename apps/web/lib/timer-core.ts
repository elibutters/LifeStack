// Pure rules for the session timer, no database. The timer lives on the server so every phone, the Mac and any agent see the same one.
import { z } from "zod";

export const TimerStyle = z.enum(["run", "lift", "event"]);
export type TimerStyle = z.infer<typeof TimerStyle>;

const itemKey = z.string().trim().min(1).max(80);

export const TimerStart = z.object({
  action: z.literal("start"),
  itemKey,
  title: z.string().trim().min(1).max(200),
  style: TimerStyle.default("event"),
  plan: z.array(z.string().trim().max(80)).max(10).default([]),
});
export const TimerStop = z.object({ action: z.literal("stop"), itemKey });
export const TimerInput = z.discriminatedUnion("action", [TimerStart, TimerStop]);

export type TimerState = { itemKey: string; title: string; style: TimerStyle; plan: string[]; startedAt: string; stoppedAt: string | null };

// A stop is remembered this long so the automatic lock-screen card does not come back for an event the user ended.
export const STOPPED_MEMORY_MS = 36 * 60 * 60 * 1000;

export function split(rows: TimerState[], now: Date): { running: TimerState | null; recentlyStopped: { itemKey: string; stoppedAt: string }[] } {
  const running = rows.filter((r) => !r.stoppedAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
  const cutoff = now.getTime() - STOPPED_MEMORY_MS;
  const recentlyStopped = rows
    .filter((r) => r.stoppedAt && new Date(r.stoppedAt).getTime() >= cutoff)
    .map((r) => ({ itemKey: r.itemKey, stoppedAt: r.stoppedAt! }))
    .sort((a, b) => b.stoppedAt.localeCompare(a.stoppedAt));
  return { running, recentlyStopped };
}

// Whole minutes between two ISO times, rounded; 0 when the order is wrong.
export const minutesBetween = (from: string, to: string): number => Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));

// The item keys the phone sends for a goal session look like "s:<session id>".
export const sessionIdOf = (itemKey: string): string | null => (itemKey.startsWith("s:") && itemKey.length > 2 ? itemKey.slice(2) : null);
