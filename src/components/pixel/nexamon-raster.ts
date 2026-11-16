import type { NexamonArt, NexamonRarity } from "@/config/nexamon/types";
import { NEXAMON_ART_SIZE } from "@/config/nexamon/types";

/*
 * A tiny RGBA raster for the Nexamon cards (ADR-165). A card face is composed once into a 72 x 100 buffer (frame,
 * artwork, plates) and painted into a single <canvas>, so even a grid of 77 cards costs 77 DOM nodes.
 * Pure functions, no DOM: the canvas part lives in the component.
 */
export interface Raster {
  readonly width: number;
  readonly height: number;
  /** RGBA, row by row. */
  readonly data: Uint8ClampedArray;
}

export type Rgb = readonly [number, number, number];

export function createRaster(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

const HEX = /^#[0-9a-f]{6}$/i;
const rgbCache = new Map<string, Rgb>();

/** "#rrggbb" to channels. Anything else throws: art colours are data and must be exact. */
export function hexToRgb(hex: string): Rgb {
  const hit = rgbCache.get(hex);
  if (hit) return hit;
  if (!HEX.test(hex)) throw new Error(`not a hex colour: ${hex}`);
  const rgb: Rgb = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  rgbCache.set(hex, rgb);
  return rgb;
}

/** Mixes two hex colours (t = 0 gives a, t = 1 gives b). */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const ch = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`;
}

/** Paints one pixel "source over" with the given opacity. Out-of-bounds pixels are ignored. */
export function setPixel(r: Raster, x: number, y: number, hex: string, alpha = 1): void {
  if (x < 0 || y < 0 || x >= r.width || y >= r.height || alpha <= 0) return;
  const [cr, cg, cb] = hexToRgb(hex);
  const i = (y * r.width + x) * 4;
  const d = r.data;
  if (alpha >= 1) {
    d[i] = cr;
    d[i + 1] = cg;
    d[i + 2] = cb;
    d[i + 3] = 255;
    return;
  }
  const below = d[i + 3]! / 255;
  const out = alpha + below * (1 - alpha);
  d[i] = Math.round((cr * alpha + d[i]! * below * (1 - alpha)) / out);
  d[i + 1] = Math.round((cg * alpha + d[i + 1]! * below * (1 - alpha)) / out);
  d[i + 2] = Math.round((cb * alpha + d[i + 2]! * below * (1 - alpha)) / out);
  d[i + 3] = Math.round(out * 255);
}

export function clearPixel(r: Raster, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= r.width || y >= r.height) return;
  r.data.fill(0, (y * r.width + x) * 4, (y * r.width + x) * 4 + 4);
}

export function fillRect(r: Raster, x: number, y: number, w: number, h: number, hex: string, alpha = 1): void {
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) setPixel(r, px, py, hex, alpha);
}

/** One-pixel outline of a rectangle. */
export function strokeRect(r: Raster, x: number, y: number, w: number, h: number, hex: string, alpha = 1): void {
  fillRect(r, x, y, w, 1, hex, alpha);
  fillRect(r, x, y + h - 1, w, 1, hex, alpha);
  fillRect(r, x, y + 1, 1, h - 2, hex, alpha);
  fillRect(r, x + w - 1, y + 1, 1, h - 2, hex, alpha);
}

/** Raised edge: light on top and left, dark on bottom and right (light from the top left). */
export function bevelRect(
  r: Raster,
  x: number,
  y: number,
  w: number,
  h: number,
  light: string,
  dark: string,
  alpha = 1,
): void {
  fillRect(r, x, y, w, 1, light, alpha);
  fillRect(r, x, y + 1, 1, h - 1, light, alpha);
  fillRect(r, x + 1, y + h - 1, w - 1, 1, dark, alpha);
  fillRect(r, x + w - 1, y + 1, 1, h - 2, dark, alpha);
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/** Ordered-dither threshold (0..1) of a pixel: the classic 4 x 4 Bayer matrix. */
export const bayer = (x: number, y: number): number => (BAYER4[y & 3]![x & 3]! + 0.5) / 16;

/**
 * Vertical gradient through `stops` (top to bottom) with ordered dithering between neighbours: the banded look of
 * old handheld games instead of a smooth blend.
 */
export function ditherRect(
  r: Raster,
  x: number,
  y: number,
  w: number,
  h: number,
  stops: readonly string[],
  alpha = 1,
): void {
  if (stops.length === 0) return;
  for (let py = 0; py < h; py++) {
    const pos = h <= 1 ? 0 : (py / (h - 1)) * (stops.length - 1);
    const base = Math.min(stops.length - 1, Math.floor(pos));
    const frac = pos - base;
    for (let px = 0; px < w; px++) {
      const next = frac > bayer(x + px, y + py) ? Math.min(stops.length - 1, base + 1) : base;
      setPixel(r, x + px, y + py, stops[next]!, alpha);
    }
  }
}

/** Draws a character grid ("." is transparent) at an offset. Characters missing from the palette are skipped. */
export function blitGrid(
  r: Raster,
  grid: readonly string[],
  palette: Readonly<Record<string, string>>,
  x: number,
  y: number,
  alpha = 1,
): void {
  for (let gy = 0; gy < grid.length; gy++) {
    const row = grid[gy]!;
    for (let gx = 0; gx < row.length; gx++) {
      const ch = row[gx]!;
      if (ch === ".") continue;
      const hex = palette[ch];
      if (hex) setPixel(r, x + gx, y + gy, hex, alpha);
    }
  }
}

/** Copies one raster onto another ("source over"). */
export function blitRaster(r: Raster, src: Raster, x: number, y: number): void {
  for (let sy = 0; sy < src.height; sy++) {
    for (let sx = 0; sx < src.width; sx++) {
      const i = (sy * src.width + sx) * 4;
      const a = src.data[i + 3]!;
      if (a === 0) continue;
      const hex = `#${[0, 1, 2].map((k) => src.data[i + k]!.toString(16).padStart(2, "0")).join("")}`;
      setPixel(r, x + sx, y + sy, hex, a / 255);
    }
  }
}

/** A sub-rectangle as its own raster (the torn-off strip of a booster pack). */
export function cropRaster(src: Raster, x: number, y: number, w: number, h: number): Raster {
  const out = createRaster(w, h);
  for (let py = 0; py < h; py++) {
    const from = ((y + py) * src.width + x) * 4;
    out.data.set(src.data.subarray(from, from + w * 4), py * w * 4);
  }
  return out;
}

/**
 * Pixel-rounded corners: clears the stair-step outside a quarter circle of the given radius (3 = the small notch
 * of a playing card).
 */
export function roundCorners(r: Raster, radius: number): void {
  for (let y = 0; y < radius; y++) {
    for (let x = 0; x < radius; x++) {
      const dx = radius - x - 0.5;
      const dy = radius - y - 0.5;
      if (dx * dx + dy * dy <= radius * radius) continue;
      clearPixel(r, x, y);
      clearPixel(r, r.width - 1 - x, y);
      clearPixel(r, x, r.height - 1 - y);
      clearPixel(r, r.width - 1 - x, r.height - 1 - y);
    }
  }
}

export const isOpaque = (r: Raster, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < r.width && y < r.height && r.data[(y * r.width + x) * 4 + 3]! > 0;

/** Number of pixels that are not transparent. */
export function countOpaque(r: Raster): number {
  let n = 0;
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i]! > 0) n++;
  return n;
}

/** The colour of a pixel as "#rrggbb", or null where the raster is transparent. */
export function pixelHex(r: Raster, x: number, y: number): string | null {
  if (!isOpaque(r, x, y)) return null;
  const i = (y * r.width + x) * 4;
  return `#${[0, 1, 2].map((k) => r.data[i + k]!.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Checks a card artwork against the contract (size for its rarity, row lengths, palette). Returns the problems in
 * plain words; an empty list means the artwork can be drawn.
 */
export function validateArt(art: NexamonArt, rarity: NexamonRarity): string[] {
  const problems: string[] = [];
  const want = NEXAMON_ART_SIZE[rarity];
  if (art.width !== want.width || art.height !== want.height)
    problems.push(`size ${art.width}x${art.height}, expected ${want.width}x${want.height}`);
  if (art.grid.length !== art.height) problems.push(`${art.grid.length} rows, expected ${art.height}`);
  const unknown = new Set<string>();
  art.grid.forEach((row, y) => {
    if (row.length !== art.width) problems.push(`row ${y} has ${row.length} pixels, expected ${art.width}`);
    for (const ch of row) if (ch !== "." && !(ch in art.palette)) unknown.add(ch);
  });
  for (const ch of unknown) problems.push(`character '${ch}' is not in the palette`);
  for (const [ch, hex] of Object.entries(art.palette))
    if (!HEX.test(hex)) problems.push(`palette '${ch}' is not a hex colour: ${hex}`);
  return problems;
}

/** Draws an artwork onto a raster; pixels outside the raster are clipped, invalid colours are skipped. */
export function blitArt(r: Raster, art: NexamonArt, x: number, y: number): void {
  const safe: Record<string, string> = {};
  for (const [ch, hex] of Object.entries(art.palette)) if (HEX.test(hex)) safe[ch] = hex;
  blitGrid(r, art.grid, safe, x, y);
}
