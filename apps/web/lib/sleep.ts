import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { events } from "@lifestack/db";
import { db } from "./db";
import { EIGHT, type NightPayload } from "./eight-map";

const Payload = z.object({
  day: z.string(),
  score: z.number().optional(),
  presenceStart: z.string().optional(),
  presenceEnd: z.string().optional(),
  presenceMin: z.number().optional(),
  sleepMin: z.number().optional(),
  lightMin: z.number().optional(),
  deepMin: z.number().optional(),
  remMin: z.number().optional(),
  awakeMin: z.number().optional(),
  tnt: z.number().optional(),
  processing: z.boolean().optional(),
  hrv: z.number().optional(),
  respiratoryAvg: z.number().optional(),
  tempBedC: z.number().optional(),
  tempRoomC: z.number().optional(),
  bedStart: z.string().optional(),
  bedEnd: z.string().optional(),
  sessions: z
    .array(
      z.object({
        id: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
        stages: z.array(z.object({ stage: z.string(), durationMin: z.number() })).optional(),
      }),
    )
    .optional(),
});

export type Night = NightPayload;

export { fmtMinutes, mean } from "./eight-map";

export async function loadNights(limit = 60): Promise<Night[]> {
  const rows = await db()
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.source, EIGHT), eq(events.key, "sleep.night")))
    .orderBy(desc(events.ts))
    .limit(limit);
  return rows.flatMap((r) => {
    const parsed = Payload.safeParse(r.payload);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function loadNightCount(): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(events)
    .where(and(eq(events.source, EIGHT), eq(events.key, "sleep.night")));
  return row?.n ?? 0;
}
