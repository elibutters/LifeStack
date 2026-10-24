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
// to is null only while the stay is still going. estimated means iOS never reported the departure, so the end is the last point seen there.
export type Stay = { from: string; to: string | null; minutes: number | null; lat: number; lon: number; place: string | null; estimated: boolean };
const ONGOING_MS = 3 * 60 * 60 * 1000;

// A stay is an arrival and the first departure after it (near the same spot, before the next arrival). No departure yet means ongoing.
// iOS can report one visit twice with slightly different coordinates, so arrivals within a minute and 300 m of an earlier one are the same.
export function staysOf(points: Pt[], places: Place[], now = new Date()): Stay[] {
  const all = [...points].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const sorted = all.filter((p, i) => p.source !== "visit-arrival" || !all.slice(0, i).some((q) => q.source === "visit-arrival" && p.ts.getTime() - q.ts.getTime() <= 60_000 && distanceM(p, q) <= 300));
  const out: Stay[] = [];
  const arrivals = sorted.filter((p) => p.source === "visit-arrival");
  sorted.forEach((p, i) => {
    if (p.source !== "visit-arrival") return;
    const next = arrivals[arrivals.indexOf(p) + 1];
    let dep: Pt | undefined, lastSeen = p.ts;
    for (const q of sorted.slice(i + 1)) {
      if (q === next) break;
      if (q.source === "visit-departure" && distanceM(p, q) <= 300) { dep = q; break; }
      if (q.source !== "visit-arrival" && distanceM(p, q) <= 300 && q.ts > lastSeen) lastSeen = q.ts;
    }
    // No departure was reported. A later arrival means the stay ended; otherwise it only counts as ongoing while the data is fresh.
    const ongoing = !dep && !next && now.getTime() - lastSeen.getTime() <= ONGOING_MS;
    const end = dep?.ts ?? (ongoing ? null : lastSeen);
    out.push({
      from: p.ts.toISOString(),
      to: end?.toISOString() ?? null,
      minutes: Math.max(0, Math.round(((end ?? now).getTime() - p.ts.getTime()) / 60_000)),
      lat: p.lat,
      lon: p.lon,
      place: placeAt(p, places)?.label ?? null,
      estimated: !dep && !ongoing,
    });
  });
  return out.reverse(); // newest first
}
