// Pure rules for the daily briefs, no database. A brief is what an agent writes after reading the owner's whole day (calendar, goals, mail,
// sleep, todos) so the owner does not have to open every tab: a headline, a few short sections, and one question to answer.
import { z } from "zod";

export const BriefKind = z.enum(["morning", "evening"]);
export type BriefKind = z.infer<typeof BriefKind>;

const Section = z.object({
  title: z.string().trim().min(1).max(60),
  items: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
});

export const BriefInput = z.object({
  kind: BriefKind,
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  headline: z.string().trim().min(1).max(240),
  sections: z.array(Section).max(6).default([]),
  question: z.string().trim().max(240).optional(),
});
export type BriefInput = z.infer<typeof BriefInput>;

export type Brief = { id: string; kind: BriefKind; day: string; headline: string; sections: { title: string; items: string[] }[]; question: string | null; createdAt: string };

export const briefId = (day: string, kind: BriefKind): string => `${day}:${kind}`;

// The brief to show now: the newest one written for today, or yesterday's evening one before the morning brief exists. Anything older is
// not shown, so a stale brief never passes for today's.
export function currentBrief(briefs: Brief[], today: string, yesterday: string): Brief | null {
  const byNewest = briefs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return byNewest.find((b) => b.day === today) ?? byNewest.find((b) => b.day === yesterday && b.kind === "evening") ?? null;
}
