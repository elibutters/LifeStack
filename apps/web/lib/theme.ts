// Palette. Hexes must match @theme in app/globals.css.
// Sampled from the Eight Sleep iOS app (home wash, stage blues, score greens), not the marketing site.
export const palette = {
  bg: "#0c1018",
  surface: "#161b24",
  raised: "#1e2532",
  line: "#2a3344",
  muted: "#8b97ad",
  fg: "#f4f6fb",
  wash: "#37559d",
  accent: "#5289fe",
  "accent-soft": "#77a2ff",
  "accent-mid": "#4d6fd6",
  "accent-deep": "#2a4c93",
  holiday: "#c4b08a",
  ok: "#3dcc5a",
  "ok-fg": "#06210a",
  danger: "#e85d5d",
  warn: "#e0b05a",
  idle: "#2a3344",
  "sleep-deep": "#2a4c93",
  "sleep-rem": "#4d6fd6",
  "sleep-light": "#77a2ff",
  "sleep-awake": "#6f85b7",
  "mood-1": "#e07090",
  "mood-2": "#e09070",
  "mood-3": "#e0b05a",
  "mood-4": "#7dcc8a",
  "mood-5": "#3dcc5a",
} as const;

export type PaletteName = keyof typeof palette;
