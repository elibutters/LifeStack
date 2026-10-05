import { palette } from "./theme";

// Life Stack mark: three stacked layers. Same artwork as public/logo-mark.svg.
const LAYERS = `
  <defs>
    <linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette["accent-soft"]}"/><stop offset="1" stop-color="${palette.accent}"/></linearGradient>
    <linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette["accent-mid"]}"/><stop offset="1" stop-color="${palette["sleep-deep"]}"/></linearGradient>
    <linearGradient id="c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette["accent-deep"]}"/><stop offset="1" stop-color="${palette["sleep-rem"]}"/></linearGradient>
  </defs>
  <path d="M256 360 L392 316 L392 288 L256 332 L120 288 L120 316 Z" fill="url(#c)"/>
  <path d="M256 304 L392 260 L392 232 L256 276 L120 232 L120 260 Z" fill="url(#b)"/>
  <path d="M256 144 L392 188 L256 232 L120 188 Z" fill="url(#a)"/>`;

const TILE = `<rect width="512" height="512" rx="112" fill="${palette.bg}"/>`;

// Tight viewBox around the layers for in-UI use, no background tile.
export const LOGO_BARE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="104 128 304 248">${LAYERS}</svg>`;

// Full-bleed square for app icons (the OS applies its own corner mask).
export function logoIconSvg(rounded: boolean) {
  const bg = rounded ? TILE : `<rect width="512" height="512" fill="${palette.bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}${LAYERS}</svg>`;
}

export function svgDataUri(svg: string) {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
