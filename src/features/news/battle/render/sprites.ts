"use client";

import { dressedFigure } from "@/components/pixel/player-figure";
import type { PixelArt } from "@/components/pixel/pixel-icon";

/*
 * Pixel art (grids of palette characters) as small canvases, made once and drawn at whole art pixels on the arena.
 */

export interface Sprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

const cache = new WeakMap<PixelArt, Map<string, Sprite>>();
let probe: CanvasRenderingContext2D | null = null;

/** Palette values may be CSS variables (var(--gold)): they are read from the document once. */
function resolve(color: string): string {
  if (!color.startsWith("var(")) return color;
  const name = color.slice(4, -1).trim();
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || "#ffffff";
}

function render(art: PixelArt, variant: string): Sprite {
  const h = art.grid.length;
  const w = art.grid[0]?.length ?? 0;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext("2d")!;
  const flip = variant.includes("flip");
  const flat = variant.includes("white") ? "#ffffff" : variant.includes("dark") ? "#151722" : null;
  art.grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = art.palette[row[x]!];
      if (!color) continue;
      ctx.fillStyle = flat ?? resolve(color);
      ctx.fillRect(flip ? w - 1 - x : x, y, 1, 1);
    }
  });
  return { canvas, w, h };
}

/** The art as a sprite; variants: "flip" (mirrored), "white" / "dark" (one colour, for flashes and burns). */
export function sprite(art: PixelArt, variant = ""): Sprite {
  let byVariant = cache.get(art);
  if (!byVariant) {
    byVariant = new Map();
    cache.set(art, byVariant);
  }
  let s = byVariant.get(variant);
  if (!s) {
    s = render(art, variant);
    byVariant.set(variant, s);
  }
  return s;
}

const figures = new Map<string, PixelArt>();

/** A player's dressed figure (24×32) as pixel art, cached by portrait and accessories. */
export function figureArt(avatarKey: string, accessories: readonly string[]): PixelArt {
  const key = `${avatarKey}|${accessories.join(",")}`;
  let art = figures.get(key);
  if (!art) {
    art = dressedFigure(avatarKey, accessories);
    figures.set(key, art);
  }
  return art;
}

/** A text measuring context (name tags). */
export function textContext(): CanvasRenderingContext2D {
  probe ??= document.createElement("canvas").getContext("2d")!;
  return probe;
}

/** A CSS custom property of the document (token colours for text on the canvas). */
export function token(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
