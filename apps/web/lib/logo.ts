import { palette } from "./theme";

// Life Stack mark: grey stack, accent only on the top layer. Same artwork as public/logo-mark.svg.
const LAYERS = `
  <path d="M256 360 L392 316 L392 288 L256 332 L120 288 L120 316 Z" fill="#3f3f3f"/>
  <path d="M256 304 L392 260 L392 232 L256 276 L120 232 L120 260 Z" fill="${palette.muted}"/>
  <path d="M256 144 L392 188 L256 232 L120 188 Z" fill="${palette.accent}"/>`;

const TILE = `<rect width="512" height="512" rx="16" fill="${palette.bg}"/>`;

// Tight viewBox around the layers for in-UI use, no background tile.
export const LOGO_BARE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="104 128 304 248">${LAYERS}</svg>`;

// Full-bleed square for app icons (the OS applies its own corner mask).
export function logoIconSvg(rounded: boolean) {
  const bg = rounded ? TILE : `<rect width="512" height="512" fill="${palette.bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}${LAYERS}</svg>`;
}

// Rounded black tile for the browser tab. Corners outside the tile stay empty.
export function logoFaviconSvg() {
  const tile = `<rect width="512" height="512" rx="96" fill="${palette.bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${tile}${LAYERS}</svg>`;
}

export function svgDataUri(svg: string) {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
