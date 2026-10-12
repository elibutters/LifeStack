// US units for display. The API stays metric.
export const MI = 1609.344;
export const miles = (m: number) => m / MI;
export const feet = (m: number) => m * 3.28084;
export const fmtMiles = (m: number, digits = 1) => `${miles(m).toFixed(digits)} mi`;
export const fmtFeet = (m: number) => `${Math.round(feet(m)).toLocaleString("en-US")} ft`;
export function fmtDuration(s: number): string {
  const t = Math.round(s);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(sec).padStart(2, "0")}`;
}
// Pace in min per mile from seconds per km.
export function fmtPace(secPerKm: number | null | undefined): string {
  if (!secPerKm) return "–";
  const spm = Math.round(secPerKm * (MI / 1000));
  return `${Math.floor(spm / 60)}:${String(spm % 60).padStart(2, "0")} /mi`;
}
