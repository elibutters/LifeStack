import type { Metadata } from "next";
import { Card } from "@/components/card";
import { LocationMap } from "@/components/location-map";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";
import { loadMapData } from "@/lib/location";

export const metadata: Metadata = { title: "Map" };
export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const dur = (m: number | null) => (m == null ? "" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);

export default async function MapPage() {
  await requireSession();
  const data = await loadMapData().catch(() => null);
  if (!data) return <p className="text-danger">Couldn&apos;t load your locations. Try again shortly.</p>;
  return (
    <>
      <PageHeader>
        <h1 className="text-3xl font-semibold tracking-tight">Map</h1>
      </PageHeader>
      <div className="max-w-4xl space-y-4">
        <Card title="Where you have been">
          {data.points.length ? <LocationMap points={data.points} places={data.places} /> : <p className="py-4 text-sm text-muted">No location points yet. Turn on Record places and trips in the iPhone app&apos;s Account screen.</p>}
        </Card>
        <Card title="Stays, last 30 days">
          {data.stays.length ? (
            <ul className="divide-y divide-line">
              {data.stays.slice(0, 40).map((s) => (
                <li key={s.from} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm">
                  <span>{s.place ?? `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`}</span>
                  <span className="text-muted tabular-nums">{when(s.from)} &middot; {s.to ? dur(s.minutes) : "now"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-2 text-sm text-muted">No stays yet. iOS reports a visit once you have stayed somewhere for a while.</p>
          )}
        </Card>
      </div>
    </>
  );
}
