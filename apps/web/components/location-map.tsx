"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

type Pt = { t: string; lat: number; lon: number; src: string; acc: number | null };
type Place = { id: number; label: string; lat: number; lon: number; radiusM: number };

const COLOR: Record<string, string> = { "visit-arrival": "#7a88ff", "visit-departure": "#a78bfa", significant: "#9ca3af", manual: "#7dd3fc" };
const NAME: Record<string, string> = { "visit-arrival": "Arrived", "visit-departure": "Left", significant: "Moved", manual: "Checked in" };
// Keyless map backgrounds. "Streets" is OpenStreetMap darkened by a CSS filter; it draws ferry routes and other detail, so the
// Esri gray canvases (no ferry lines) come first. "Points only" draws no map at all and sends nothing to a third party.
const STYLES = {
  dark: { label: "Dark, minimal", url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", attribution: "Tiles &copy; Esri", maxNative: 16, className: "" },
  light: { label: "Light, minimal", url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", attribution: "Tiles &copy; Esri", maxNative: 16, className: "" },
  streets: { label: "Streets (detailed)", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxNative: 19, className: "map-tiles-dark" },
  satellite: { label: "Satellite", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: "Tiles &copy; Esri", maxNative: 19, className: "" },
  none: { label: "Points only", url: "", attribution: "", maxNative: 19, className: "" },
} as const;
type StyleKey = keyof typeof STYLES;
const RANGES = [{ key: "7", label: "7 days", days: 7 }, { key: "30", label: "30 days", days: 30 }, { key: "all", label: "All", days: 0 }] as const;

export function LocationMap({ points, places }: { points: Pt[]; places: Place[] }) {
  const el = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("all");
  const [style, setStyle] = useState<StyleKey>("dark");
  const [lines, setLines] = useState(true);
  // Remember the choices on this browser (a convenience only; it works without storage).
  useEffect(() => {
    try {
      const st = window.localStorage.getItem("ls-map-style") as StyleKey | null;
      if (st && st in STYLES) setStyle(st);
      if (window.localStorage.getItem("ls-map-lines") === "0") setLines(false);
    } catch {}
  }, []);
  const choose = (st: StyleKey) => { setStyle(st); try { window.localStorage.setItem("ls-map-style", st); } catch {} };
  const toggleLines = (on: boolean) => { setLines(on); try { window.localStorage.setItem("ls-map-lines", on ? "1" : "0"); } catch {} };
  const days = RANGES.find((r) => r.key === range)!.days;
  const shown = days ? points.filter((p) => Date.now() - Date.parse(p.t) <= days * 86_400_000) : points;

  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current) return;
      map = L.map(el.current, { zoomControl: true, attributionControl: true });
      const st = STYLES[style];
      if (st.url) {
        L.tileLayer(st.url, {
          attribution: st.attribution,
          maxZoom: 19,
          maxNativeZoom: st.maxNative,
          className: st.className,
          // The site sends Referrer-Policy: no-referrer, but some tile servers (OpenStreetMap) block requests with no referrer.
          // Send only this site's address, never a path or any point data.
          referrerPolicy: "origin",
        }).addTo(map);
      }

      const all: [number, number][] = [];
      if (lines && shown.length > 1) L.polyline(shown.map((p) => [p.lat, p.lon] as [number, number]), { color: "#7a88ff", weight: 2, opacity: 0.3 }).addTo(map);
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
  }, [range, style, lines]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button key={r.key} type="button" onClick={() => setRange(r.key)} aria-pressed={range === r.key} className={`h-8 rounded-md border px-3 text-sm ${range === r.key ? "border-accent text-fg" : "border-line text-muted hover:bg-raised"}`}>
            {r.label}
          </button>
        ))}
        <select value={style} onChange={(e) => choose(e.target.value as StyleKey)} aria-label="Map style" className="h-8 rounded-md border border-line bg-surface px-2 text-sm">
          {Object.entries(STYLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted"><input type="checkbox" checked={lines} onChange={(e) => toggleLines(e.target.checked)} className="h-4 w-4" />Lines</label>
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
