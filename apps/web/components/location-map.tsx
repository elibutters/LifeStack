"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

type Pt = { t: string; lat: number; lon: number; src: string; acc: number | null };
type Place = { id: number; label: string; lat: number; lon: number; radiusM: number };

const COLOR: Record<string, string> = { "visit-arrival": "#7a88ff", "visit-departure": "#a78bfa", significant: "#9ca3af", manual: "#7dd3fc" };
const NAME: Record<string, string> = { "visit-arrival": "Arrived", "visit-departure": "Left", significant: "Moved", manual: "Checked in" };
const RANGES = [{ key: "7", label: "7 days", days: 7 }, { key: "30", label: "30 days", days: 30 }, { key: "all", label: "All", days: 0 }] as const;

export function LocationMap({ points, places }: { points: Pt[]; places: Place[] }) {
  const el = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("all");
  const days = RANGES.find((r) => r.key === range)!.days;
  const shown = days ? points.filter((p) => Date.now() - Date.parse(p.t) <= days * 86_400_000) : points;

  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current) return;
      map = L.map(el.current, { zoomControl: true, attributionControl: true });
      // OpenStreetMap's own tiles need no key. They are light, so a CSS filter (map-tiles-dark) darkens them to match the app.
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
        className: "map-tiles-dark",
      }).addTo(map);

      const all: [number, number][] = [];
      if (shown.length > 1) L.polyline(shown.map((p) => [p.lat, p.lon] as [number, number]), { color: "#7a88ff", weight: 2, opacity: 0.3 }).addTo(map);
      for (const p of shown) {
        all.push([p.lat, p.lon]);
        const when = new Date(p.t).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        L.circleMarker([p.lat, p.lon], { radius: 5, color: "#0a0a0b", weight: 1, fillColor: COLOR[p.src] ?? "#9ca3af", fillOpacity: 0.9 })
          .bindTooltip(`${NAME[p.src] ?? p.src} · ${when}${p.acc != null ? ` · ±${Math.round(p.acc)} m` : ""}`)
          .addTo(map);
      }
      for (const pl of places) {
        all.push([pl.lat, pl.lon]);
        L.circle([pl.lat, pl.lon], { radius: pl.radiusM, color: "#34d399", weight: 1.5, fillOpacity: 0.12 }).bindTooltip(pl.label, { permanent: true, direction: "top", offset: [0, -4] }).addTo(map);
      }
      if (all.length) map.fitBounds(L.latLngBounds(all).pad(0.15), { maxZoom: 16 });
      else map.setView([40.7128, -74.006], 11);
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw only when the range changes
  }, [range]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button key={r.key} type="button" onClick={() => setRange(r.key)} aria-pressed={range === r.key} className={`h-8 rounded-md border px-3 text-sm ${range === r.key ? "border-accent text-fg" : "border-line text-muted hover:bg-raised"}`}>
            {r.label}
          </button>
        ))}
        <span className="ml-auto text-sm text-muted tabular-nums">{shown.length} point{shown.length === 1 ? "" : "s"}</span>
      </div>
      <div ref={el} className="h-[60vh] min-h-80 w-full overflow-hidden rounded-md border border-line bg-surface" role="img" aria-label="Map of where you have been" />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {Object.entries(NAME).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: COLOR[k] }} />{v}</span>
        ))}
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-[#34d399]" />Saved place</span>
      </div>
    </div>
  );
}
