// Palette. Hexes must match @theme in app/globals.css.
// Black chrome. Colour is reserved for focus (accent), status, and one series.
export const palette = {
  bg: "#000000",
  surface: "#0a0a0a",
  raised: "#141414",
  line: "#2a2a2a",
  muted: "#8a8a8a",
  fg: "#ededed",
  wash: "#000000",
  accent: "#6ea8ff",
  "accent-soft": "#b9d4ff",
  "accent-mid": "#3d6cb5",
  "accent-deep": "#1e3a66",
  holiday: "#d4b483",
  ok: "#3ecf8e",
  "ok-fg": "#04140c",
  danger: "#f07178",
  warn: "#e6b15c",
  idle: "#2a2a2a",
  "sleep-deep": "#6ea8ff",
  "sleep-rem": "#8aa4cc",
  "sleep-light": "#4a5568",
  "sleep-awake": "#e6b15c",
  "mood-1": "#f07178",
  "mood-2": "#c4846a",
  "mood-3": "#8a8a8a",
  "mood-4": "#7dba9a",
  "mood-5": "#3ecf8e",
} as const;

export type PaletteName = keyof typeof palette;
