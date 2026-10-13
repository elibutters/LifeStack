import { z } from "zod";

// Pure rules for location history: what a reported point looks like, distances, naming places and pairing visits into stays.
export const POINT_SOURCES = ["visit-arrival", "visit-departure", "significant", "manual"] as const;
export type PointSource = (typeof POINT_SOURCES)[number];

export const PointInput = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  at: z.string().datetime({ offset: true }),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100_000).optional(),
  source: z.enum(POINT_SOURCES),
});
export const BatchInput = z.object({ points: z.array(PointInput).min(1).max(200) });
export type PointIn = z.infer<typeof PointInput>;

export const PlaceInput = z.object({
  label: z.string().trim().min(1).max(60),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radiusM: z.number().int().min(20).max(2000).default(100),
});

const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;
export const notTooFuture = (at: string, now: Date) => new Date(at).getTime() <= now.getTime() + FUTURE_SLACK_MS;

const R = 6_371_000;
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type Place = { id: number; label: string; lat: number; lon: number; radiusM: number };

// The closest named place whose radius contains the point.
export function placeAt(p: { lat: number; lon: number }, places: Place[]): Place | null {
  let best: Place | null = null, bestD = Infinity;
  for (const pl of places) {
    const d = distanceM(p, pl);
    if (d <= pl.radiusM && d < bestD) { best = pl; bestD = d; }
  }
  return best;
}

export type Pt = { ts: Date; lat: number; lon: number; source: string };
export type Stay = { from: string; to: string | null; minutes: number | null; lat: number; lon: number; place: string | null };

// A stay is an arrival and the first departure after it (near the same spot, before the next arrival). No departure yet means ongoing.
export function staysOf(points: Pt[], places: Place[], now = new Date()): Stay[] {
  const sorted = [...points].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const out: Stay[] = [];
  sorted.forEach((p, i) => {
    if (p.source !== "visit-arrival") return;
    let dep: Pt | undefined;
    for (const q of sorted.slice(i + 1)) {
      if (q.source === "visit-arrival") break;
      if (q.source === "visit-departure" && distanceM(p, q) <= 300) { dep = q; break; }
    }
    const end = dep?.ts ?? null;
    out.push({
      from: p.ts.toISOString(),
      to: end?.toISOString() ?? null,
      minutes: Math.max(0, Math.round(((end ?? now).getTime() - p.ts.getTime()) / 60_000)),
      lat: p.lat,
      lon: p.lon,
      place: placeAt(p, places)?.label ?? null,
    });
  });
  return out.reverse(); // newest first
}
