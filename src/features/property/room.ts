import type { Sprite } from "@/config/furniture";
import { FLOOR_TILES, FURNITURE, TILE } from "@/config/furniture";
import type { FloorMaterial } from "@/config/balance";

/*
 * Drawing helpers for homes (ADR-082): the room backdrop (floor tiles and walls) and rotated furniture sprites.
 * Pure data, so the room view, the editor and the profile share them.
 */
const IDX = "0123456789abcdef";
/** Height of the back wall in art pixels. */
export const WALL = 12;

function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * factor)));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

/** Floor tiles in the chosen material, a back wall in the chosen colour with a baseboard, thin side walls. */
export function roomBackdrop(width: number, height: number, floor: FloorMaterial, wall: string): Sprite {
  const tile = FLOOR_TILES[floor];
  const palette = [...tile.palette];
  const add = (c: string) => {
    palette.push(c);
    return IDX[palette.length - 1]!;
  };
  const wallC = add(wall);
  const wallDark = add(shade(wall, 0.82));
  const base = add(shade(wall, 0.55));
  const side = add(shade(wall, 0.7));
  const W = width * TILE;
  const grid: string[] = [];
  for (let y = 0; y < WALL; y++) {
    let row = "";
    for (let x = 0; x < W; x++) row += y >= WALL - 2 ? base : y % 6 === 5 && (x + y) % 2 === 0 ? wallDark : wallC;
    grid.push(row);
  }
  for (let y = 0; y < height * TILE; y++) {
    let row = "";
    for (let x = 0; x < W; x++) row += x < 2 || x >= W - 2 ? side : tile.grid[y % TILE]![x % TILE]!;
    grid.push(row);
  }
  return { palette, grid };
}

/** Furniture rotated by 90° clockwise (width and height swap). */
export function rotateSprite(sprite: Sprite): Sprite {
  const h = sprite.grid.length;
  const w = sprite.grid[0]?.length ?? 0;
  const grid = Array.from({ length: w }, (_, y) =>
    Array.from({ length: h }, (_, x) => sprite.grid[h - 1 - x]![y]!).join(""),
  );
  return { palette: sprite.palette, grid };
}

const rotatedCache = new Map<string, Sprite>();
export function furnitureSprite(itemKey: string, rot: 0 | 90): Sprite | null {
  const item = FURNITURE.find((f) => f.key === itemKey);
  if (!item) return null;
  if (rot === 0) return item.sprite;
  let s = rotatedCache.get(itemKey);
  if (!s) {
    s = rotateSprite(item.sprite);
    rotatedCache.set(itemKey, s);
  }
  return s;
}

export function furnitureItem(itemKey: string) {
  return FURNITURE.find((f) => f.key === itemKey);
}

export type FurnitureLayer = "floor" | "object" | "top";
const LAYER_RANK: Record<FurnitureLayer, number> = { floor: 0, object: 1, top: 2 };

/**
 * Drawing order (ADR-100): rugs first, then furniture, then the small things standing on it; within a layer from the
 * back wall to the front, so pieces further down cover the ones behind them.
 */
export function drawOrder<T extends { x: number; y: number }>(
  pieces: readonly T[],
  layerOf: (p: T) => FurnitureLayer | undefined,
): T[] {
  return [...pieces].sort((a, b) => {
    const la = LAYER_RANK[layerOf(a) ?? "object"];
    const lb = LAYER_RANK[layerOf(b) ?? "object"];
    return la !== lb ? la - lb : a.y !== b.y ? a.y - b.y : a.x - b.x;
  });
}
