"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

type Pt = { t: string; lat: number; lon: number; src: string; acc: number | null };
type Place = { id: number; label: string; lat: number; lon: number; radiusM: number };

const COLOR: Record<string, string> = { "visit-arrival": "#ffffff", "visit-departure": "#bdbdbd", significant: "#8a8a8a", manual: "#e5e5e5", trip: "#5c5c5c" };
const NAME: Record<string, string> = { "visit-arrival": "Arrived", "visit-departure": "Left", significant: "Moved", manual: "Checked in", trip: "Trip" };
// Keyless map backgrounds. "Streets" is OpenStreetMap darkened by a CSS filter; it draws ferry routes and other detail, so the
// Esri gray canvases (no ferry lines) come first. "Points only" draws no map at all and sends nothing to a third party.
const STYLES = {
  dark: { label: "Dark, minimal", url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", attribution: "Tiles &copy; Esri", maxNative: 16, className: "" },
  light: { label: "Light, minimal", url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", attribution: "Tiles &copy; Esri", maxNative: 16, className: "" },
  streets: { label: "Streets (detailed)", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxNative: 19, className: "map-tiles-dark" },
  satellite: { label: "Satellite", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: "Tiles &copy; Esri", maxNative: 19, className: "" },
  none: { label: "Points only", url: "", attribution: "", maxNative: 19, className: "" },
} as const;
export type StyleKey = keyof typeof STYLES;
const RANGES = [{ key: "7", label: "7 days", days: 7 }, { key: "30", label: "30 days", days: 30 }, { key: "all", label: "All", days: 0 }] as const;

const WINDOWS = [{ key: "all", label: "Whole trail", ms: 0 }, { key: "24", label: "Last 24 h", ms: 24 * 3_600_000 }, { key: "6", label: "Last 6 h", ms: 6 * 3_600_000 }, { key: "1", label: "Last hour", ms: 3_600_000 }] as const;
const SPEEDS = [1, 3, 10] as const;
const fmt = (t: string) => new Date(t).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export type MapDefaults = { style: StyleKey; lines: boolean; range: (typeof RANGES)[number]["key"] };

// defaults come from the owner's preferences (changeable without a deploy). A choice made in this browser wins only if it was made
// after the preferences last changed, so changing a default always shows up.
export function LocationMap({ points, places, defaults, defaultsAt }: { points: Pt[]; places: Place[]; defaults: MapDefaults; defaultsAt: string | null }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const fitFor = useRef("");
  const [mapVersion, setMapVersion] = useState(0);
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>(defaults.range);
  const [style, setStyle] = useState<StyleKey>(defaults.style);
  const [lines, setLines] = useState(defaults.lines);
  // The time slider: null means "everything" (the end); a number is a position in the list of points.
  const [cursor, setCursor] = useState<number | null>(null);
  const [engaged, setEngaged] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(3);
  const [win, setWin] = useState<(typeof WINDOWS)[number]["key"]>("all");

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("ls-map-prefs") ?? "null") as { style?: StyleKey; lines?: boolean; at?: number } | null;
      if (saved?.at && saved.at > (defaultsAt ? Date.parse(defaultsAt) : 0)) {
        if (saved.style && saved.style in STYLES) setStyle(saved.style);
        if (typeof saved.lines === "boolean") setLines(saved.lines);
      }
    } catch {}
  }, [defaultsAt]);
  const remember = (st: StyleKey, ln: boolean) => { try { window.localStorage.setItem("ls-map-prefs", JSON.stringify({ style: st, lines: ln, at: Date.now() })); } catch {} };
  const choose = (st: StyleKey) => { setStyle(st); remember(st, lines); };
  const toggleLines = (on: boolean) => { setLines(on); remember(style, on); };

  const days = RANGES.find((r) => r.key === range)!.days;
  const shown = useMemo(() => (days ? points.filter((p) => Date.now() - Date.parse(p.t) <= days * 86_400_000) : points), [points, days]);
  const last = shown.length - 1;
  const ci = cursor === null ? last : Math.min(cursor, last);
  const windowMs = WINDOWS.find((w) => w.key === win)!.ms;

  const changeRange = (r: typeof range) => { setRange(r); setCursor(null); setEngaged(false); setPlaying(false); };

  // Playback: step forward a few points at a time until the end.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setCursor((c) => {
        const next = (c ?? 0) + speed;
        if (next >= last) { setPlaying(false); return null; }
        return next;
      });
    }, 120);
    return () => clearInterval(id);
  }, [playing, speed, last]);

  // The map itself and its background; rebuilt only when the style changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current) return;
      const map = L.map(el.current, { zoomControl: true, attributionControl: true, preferCanvas: true });
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
      LRef.current = L;
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      fitFor.current = "";
      setMapVersion((v) => v + 1);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [style]);

  // The dots, lines and places; redrawn cheaply as the slider moves, without touching the map background.
  useEffect(() => {
    const L = LRef.current, map = mapRef.current, layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    const now = shown[ci] ? Date.parse(shown[ci]!.t) : 0;
    const visible = shown.slice(0, ci + 1).filter((p) => !windowMs || now - Date.parse(p.t) <= windowMs);
    if (lines && visible.length > 1) L.polyline(visible.map((p) => [p.lat, p.lon] as [number, number]), { color: "#ffffff", weight: 2, opacity: 0.35 }).addTo(layer);
    for (const p of visible) {
      const age = windowMs ? (now - Date.parse(p.t)) / windowMs : 0;
      L.circleMarker([p.lat, p.lon], { radius: p.src === "trip" ? 3 : 5, color: "#0a0a0b", weight: 1, fillColor: COLOR[p.src] ?? "#9ca3af", fillOpacity: windowMs ? 0.25 + 0.65 * (1 - age) : 0.9 })
        .bindTooltip(`${NAME[p.src] ?? p.src} \u00b7 ${fmt(p.t)}${p.acc != null ? ` \u00b7 \u00b1${Math.round(p.acc)} m` : ""}`)
        .addTo(layer);
    }
    for (const pl of places) {
      L.circle([pl.lat, pl.lon], { radius: pl.radiusM, color: "#6ea8ff", weight: 1.5, fillOpacity: 0.08 }).bindTooltip(pl.label, { permanent: true, direction: "top", offset: [0, -4] }).addTo(layer);
    }
    // While scrubbing, mark where you were at the chosen moment.
    const here = shown[ci];
    if (engaged && here) L.circleMarker([here.lat, here.lon], { radius: 9, color: "#000000", weight: 2, fillColor: "#6ea8ff", fillOpacity: 1 }).bindTooltip(fmt(here.t), { permanent: true, direction: "top", offset: [0, -8] }).addTo(layer);
    // Fit the view once per range and style, not on every slider step, so playback does not jump around.
    const key = `${range}|${mapVersion}`;
    if (fitFor.current !== key) {
      fitFor.current = key;
      const all: [number, number][] = [...shown.map((p) => [p.lat, p.lon] as [number, number]), ...places.map((pl) => [pl.lat, pl.lon] as [number, number])];
      if (all.length) map.fitBounds(L.latLngBounds(all).pad(0.15), { maxZoom: 16 });
      else map.setView([40.7128, -74.006], 11);
    }
  }, [mapVersion, shown, places, lines, ci, windowMs, engaged, range]);

  const btn = (on: boolean) => `h-8 rounded-md border px-3 text-sm ${on ? "border-accent text-fg" : "border-line text-muted hover:bg-raised"}`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button key={r.key} type="button" onClick={() => changeRange(r.key)} aria-pressed={range === r.key} className={btn(range === r.key)}>
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
      {shown.length > 1 && (
        <div className="mt-3 space-y-2 rounded-md border border-line bg-surface px-3 py-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { if (playing) setPlaying(false); else { setEngaged(true); if (cursor === null || cursor >= last) setCursor(0); setPlaying(true); } }}
              className={btn(playing)}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <input
              type="range"
              min={0}
              max={last}
              value={ci}
              onChange={(e) => { setEngaged(true); setPlaying(false); setCursor(Number(e.target.value)); }}
              aria-label="Move through time"
              className="min-w-0 flex-1 accent-[var(--color-accent)]"
            />
            <span className="w-44 shrink-0 text-right text-sm tabular-nums">{shown[ci] ? fmt(shown[ci]!.t) : ""}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <label className="flex items-center gap-1.5">Trail
              <select value={win} onChange={(e) => setWin(e.target.value as typeof win)} aria-label="Trail length" className="h-8 rounded-md border border-line bg-surface px-2 text-sm text-fg">
                {WINDOWS.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5">Speed
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value) as typeof speed)} aria-label="Playback speed" className="h-8 rounded-md border border-line bg-surface px-2 text-sm text-fg">
                {SPEEDS.map((v) => <option key={v} value={v}>{v}x</option>)}
              </select>
            </label>
            {engaged && <button type="button" onClick={() => { setCursor(null); setEngaged(false); setPlaying(false); }} className={btn(false)}>Show everything</button>}
            <span className="ml-auto tabular-nums">{ci + 1} of {shown.length}</span>
          </div>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {Object.entries(NAME).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: COLOR[k] }} />{v}</span>
        ))}
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm border border-accent" />Saved place</span>
      </div>
    </div>
  );
}
