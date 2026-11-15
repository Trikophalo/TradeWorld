import { ACCESSORY_SLOTS, accessoryByKey, type AccessorySlot } from "../../config/accessories";
import { ACCESSORY_ART, type AccessoryArt } from "./accessories";
import { avatarArt } from "./avatars";
import type { PixelArt } from "./pixel-icon";

/*
 * The full-body player figure (ADR-155): 24×32, in the colours of the chosen portrait (skin, hair, outfit, accent),
 * with room above the head for hats and at the sides for a pet, a held thing and wings. Accessories are layered on in
 * a fixed order (back, figure, body, face, head, hand, pet); the right hand is drawn again over a held thing, so it
 * grips. Pure data and functions, no React.
 */

export const FIGURE_WIDTH = 24;
export const FIGURE_HEIGHT = 32;

const FIXED: Readonly<Record<string, string>> = {
  k: "#232634",
  p: "#2b3245",
  f: "#151722",
  m: "#8a3a3a",
  r: "#f08a8a",
};
const FALLBACK_HAIR = "#4a3020";

/** h hair, s skin, d skin shade, e eyes, r blush, m mouth, o outfit, c accent, p trousers, f shoes, k outline. */
const FIGURE: readonly string[] = [
  "........................",
  "........................",
  "........................",
  "........................",
  "........................",
  "........................",
  "........kkkkkkkk........",
  ".......khhhhhhhhk.......",
  "......khhhhhhhhhhk......",
  "......khhhhhhhhhhk......",
  "......khhsssssshhk......",
  "......khsssssssshk......",
  "......kssessssessk......",
  "......kssessssessk......",
  "......ksrssmmssrsk......",
  ".......kssssssssk.......",
  "........kkkddkkk........",
  ".....koooooccoooook.....",
  "....kooooooccooooook....",
  "....kokooooccooookok....",
  "....kokooooccooookok....",
  "....kokooooccooookok....",
  "....kokooooccooookok....",
  "....kskooooccooooksk....",
  "....kskkkkkkkkkkkksk....",
  "....kk.kppppppppk.kk....",
  ".......kppppppppk.......",
  ".......kpppkkpppk.......",
  ".......kpppkkpppk.......",
  ".......kpppkkpppk.......",
  "......kffffkkffffk......",
  "......kkkkkkkkkkkk......",
];

/** The hand that holds things (x, y). */
const GRIP: readonly (readonly [number, number])[] = [
  [18, 23],
  [18, 24],
];

/** Portraits with long hair, a mohawk or glasses get them on the figure too. */
const LONG_HAIR = new Set(["seller"]);
const MOHAWK = new Set(["punk"]);
const GLASSES = new Set(["analyst", "scientist"]);

type Canvas = (string | null)[][];

/** The colours of a portrait that the figure (and "$x" palette entries of accessories) use. */
export function figureColors(avatarKey: string | null | undefined): Readonly<Record<string, string>> {
  const p = avatarArt(avatarKey).palette;
  const hair = p.h ?? (avatarKey === "finn_fan" ? p.a : undefined) ?? FALLBACK_HAIR;
  return {
    ...FIXED,
    h: hair,
    s: p.s ?? "#e8b48a",
    d: p.d ?? "#c47f5c",
    e: p.e ?? "#151722",
    o: p.o ?? "#4f8cff",
    c: p.c ?? "#eef0f6",
  };
}

function bareFigure(avatarKey: string | null | undefined, colors: Readonly<Record<string, string>>): Canvas {
  const canvas: Canvas = FIGURE.map((row) => row.split("").map((ch) => (ch === "." ? null : (colors[ch] ?? null))));
  const set = (x: number, y: number, color: string | null) => {
    const row = canvas[y];
    if (row && x >= 0 && x < FIGURE_WIDTH) row[x] = color;
  };
  const key = avatarKey ?? "";
  if (LONG_HAIR.has(key)) {
    for (let y = 9; y <= 17; y++) {
      set(5, y, colors.h!);
      set(18, y, colors.h!);
    }
    for (let y = 10; y <= 16; y++) {
      set(6, y, colors.h!);
      set(17, y, colors.h!);
    }
  }
  if (MOHAWK.has(key)) {
    for (let y = 7; y <= 9; y++)
      for (const x of [7, 8, 9, 10, 13, 14, 15, 16]) if (canvas[y]![x] === colors.h) set(x, y, colors.s!);
    for (let y = 2; y <= 6; y++) {
      set(11, y, colors.h!);
      set(12, y, colors.h!);
    }
  }
  if (GLASSES.has(key)) {
    const frame = avatarArt(avatarKey).palette.a ?? "#151722";
    for (let x = 8; x <= 15; x++) set(x, 12, frame);
    for (const x of [8, 10, 13, 15]) set(x, 13, frame);
  }
  return canvas;
}

function paint(canvas: Canvas, art: AccessoryArt, colors: Readonly<Record<string, string>>): void {
  art.grid.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const ch = row[dx]!;
      if (ch === ".") continue;
      const raw = art.palette[ch];
      if (!raw) continue;
      const color = raw.startsWith("$") ? (colors[raw.slice(1)] ?? null) : raw;
      const line = canvas[art.y + dy];
      if (line && art.x + dx < FIGURE_WIDTH) line[art.x + dx] = color;
    }
  });
}

const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function toArt(canvas: Canvas): PixelArt {
  const index = new Map<string, string>();
  const palette: Record<string, string> = {};
  const grid = canvas.map((row) =>
    row
      .map((color) => {
        if (color === null) return ".";
        let ch = index.get(color);
        if (!ch) {
          ch = CHARS[index.size] ?? "z";
          index.set(color, ch);
          palette[ch] = color;
        }
        return ch;
      })
      .join(""),
  );
  return { grid, palette };
}

/**
 * Worn accessories in drawing order: known keys only, one per slot (the first wins), sorted back to front.
 */
export function orderWorn(worn: readonly string[]): string[] {
  const bySlot = new Map<AccessorySlot, string>();
  for (const key of worn) {
    const item = accessoryByKey(key);
    if (item && ACCESSORY_ART[key] && !bySlot.has(item.slot)) bySlot.set(item.slot, key);
  }
  return ACCESSORY_SLOTS.flatMap((slot) => (bySlot.has(slot) ? [bySlot.get(slot)!] : []));
}

/** The figure of a portrait without accessories. */
export function playerFigure(avatarKey: string | null | undefined): PixelArt {
  return dressedFigure(avatarKey, []);
}

/** The figure of a portrait wearing the given accessories (unknown keys and second items of a slot are ignored). */
export function dressedFigure(avatarKey: string | null | undefined, worn: readonly string[]): PixelArt {
  const colors = figureColors(avatarKey);
  const order = orderWorn(worn);
  const layer = (slot: AccessorySlot) => order.find((key) => accessoryByKey(key)?.slot === slot);
  const canvas: Canvas = Array.from({ length: FIGURE_HEIGHT }, () => Array<string | null>(FIGURE_WIDTH).fill(null));
  const back = layer("back");
  if (back) paint(canvas, ACCESSORY_ART[back]!, colors);
  // the figure covers whatever is behind it
  bareFigure(avatarKey, colors).forEach((row, y) =>
    row.forEach((color, x) => {
      if (color !== null) canvas[y]![x] = color;
    }),
  );
  for (const slot of ["body", "face", "head"] as const) {
    const key = layer(slot);
    if (key) paint(canvas, ACCESSORY_ART[key]!, colors);
  }
  const hand = layer("hand");
  if (hand) {
    const grip = GRIP.map(([x, y]) => canvas[y]![x] ?? null);
    paint(canvas, ACCESSORY_ART[hand]!, colors);
    GRIP.forEach(([x, y], i) => {
      canvas[y]![x] = grip[i] ?? null;
    });
  }
  const pet = layer("pet");
  if (pet) paint(canvas, ACCESSORY_ART[pet]!, colors);
  return toArt(canvas);
}
