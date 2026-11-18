/*
 * The headquarters of a company on the world map (ADR-208): a classic company building drawn as pixel art from the
 * tier (1 Bürogebäude … 5 Mega-Campus, 0 = subsidiary) and the style of the HQ editor (wall, roof and sign color, roof
 * kind, decoration, flag of the country, sign with the company's initials). Original designs, no real buildings or
 * logos. Pure: the same input always gives the same grid; rendered by PixelIcon (integer scaling only).
 */
import type { PixelArt } from "./pixel-icon";

export const HQ_CANVAS = { width: 28, height: 28 } as const;

/** Building palettes (data, like every pixel palette). */
export const HQ_WALL_COLORS = [
  "#e8dcc4",
  "#c9d3de",
  "#f2b880",
  "#9fb8a0",
  "#d98f7a",
  "#b9a6d9",
  "#7f8ea3",
  "#f4f1ea",
] as const;
export const HQ_ROOF_COLORS = [
  "#5b6b82",
  "#c8553d",
  "#3f7f6a",
  "#2f3b52",
  "#d9a441",
  "#8a4f7d",
  "#4a8fc0",
  "#6d6d6d",
] as const;
export const HQ_SIGN_COLORS = [
  "#ffd15c",
  "#ff6170",
  "#62c8ff",
  "#7be08f",
  "#ffffff",
  "#ff9f43",
  "#c792ea",
  "#1f2633",
] as const;

const OUTLINE = "#1b1f2a";

export interface HqArtInput {
  /** 1..5 headquarters, 0 = subsidiary (a small office). */
  tier: number;
  wall?: number;
  roof?: number;
  sign?: number;
  roofKind?: string;
  deco?: string;
  /** Up to three colors of the country's flag; null hides the flag. */
  flag?: readonly string[] | null;
  flagVertical?: boolean;
  /** Initials on the sign (1–2 letters). */
  initials?: string;
}

/** 3×5 letters for the sign. */
const FONT: Record<string, readonly string[]> = {
  A: ["###", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: ["###", "#..", "#..", "#..", "###"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: ["###", "#..", "#.#", "#.#", "###"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", "###"],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["##.", "#.#", "#.#", "#.#", "#.#"],
  O: ["###", "#.#", "#.#", "#.#", "###"],
  P: ["###", "#.#", "###", "#..", "#.."],
  Q: ["###", "#.#", "#.#", "###", "..#"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: ["###", "#..", "###", "..#", "###"],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["##.", "..#", ".#.", "#..", "###"],
  "3": ["##.", "..#", ".#.", "..#", "##."],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "##.", "..#", "##."],
  "6": [".##", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "##."],
};

/** Up to two initials of a company name: first letters of the first two words (umlauts folded). */
export function companyInitials(name: string): string {
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "SS").toUpperCase();
  const words = fold(name)
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const first = words[0] ?? "";
  const letters = words.length > 1 ? (first[0] ?? "") + (words[1]?.[0] ?? "") : first.slice(0, 2);
  return letters.slice(0, 2) || "N";
}

interface Body {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Shapes per tier: the main body first (sign, door, roof), wings after it. Bottom row is y = 25. */
function bodies(tier: number): Body[] {
  const ground = 26;
  const at = (w: number, h: number, dx = 0): Body => ({
    x: Math.floor((HQ_CANVAS.width - w) / 2) + dx,
    y: ground - h,
    w,
    h,
  });
  switch (tier) {
    case 0:
      return [at(10, 8)];
    case 1:
      return [at(12, 11)];
    case 2:
      return [at(16, 14)];
    case 3:
      return [at(12, 15), at(6, 9, -8), at(6, 9, 8)];
    case 4:
      return [at(12, 22), at(22, 6)];
    default:
      return [at(12, 17), at(8, 11, -9), at(8, 11, 9)];
  }
}

export function hqArt(input: HqArtInput): PixelArt {
  const W = HQ_CANVAS.width;
  const H = HQ_CANVAS.height;
  const px: string[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => "."));
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && x < W && y >= 0 && y < H) px[y]![x] = c;
  };
  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, c);
  };
  const tier = Math.max(0, Math.min(5, Math.round(input.tier)));
  const list = bodies(tier);
  const main = list[0]!;

  // wings first, then the main body on top
  for (const b of [...list.slice(1), main]) {
    rect(b.x, b.y, b.w, b.h, "k");
    rect(b.x + 1, b.y + 1, b.w - 2, b.h - 1, "w");
    rect(b.x + b.w - 2, b.y + 1, 1, b.h - 1, "d"); // shade on the right
    // windows: every other column and row, glass with a light corner
    for (let j = b.y + 2; j < b.y + b.h - 2; j += 2) {
      for (let i = b.x + 2; i < b.x + b.w - 2; i += 2) {
        set(i, j, (i + j) % 6 === 0 ? "G" : "g");
      }
    }
  }
  // tower: a glass band every few floors
  if (tier === 4) {
    for (let j = main.y + 3; j < main.y + main.h - 6; j += 4) rect(main.x + 1, j, main.w - 2, 1, "g");
  }
  // sign with the initials
  const initials = (input.initials ?? "").toUpperCase().slice(0, tier === 0 ? 1 : 2);
  if (tier > 0 && main.w >= 10) {
    const sw = initials.length > 1 ? 9 : 5;
    const sx = main.x + Math.floor((main.w - sw) / 2);
    const sy = main.y + 1;
    rect(sx, sy, sw, 7, "s");
    [...initials].forEach((ch, n) => {
      const glyph = FONT[ch] ?? FONT.N!;
      glyph.forEach((row, gy) =>
        [...row].forEach((c, gx) => {
          if (c === "#") set(sx + 1 + n * 4 + gx, sy + 1 + gy, "t");
        }),
      );
    });
  } else {
    rect(main.x + 3, main.y + 1, main.w - 6, 2, "s");
  }
  // door
  const dx = main.x + Math.floor(main.w / 2) - 1;
  rect(dx, main.y + main.h - 3, 2, 3, "o");

  // roof
  const top = main.y;
  const cx = main.x + Math.floor(main.w / 2);
  const kind = input.roofKind ?? "flat";
  let flagBase = { x: main.x + main.w - 3, y: top - 1 };
  if (kind === "gable") {
    const half = Math.ceil(main.w / 2);
    for (let r = 0; r < Math.min(half, 6); r++) {
      rect(main.x + r, top - 1 - r, main.w - 2 * r, 1, r === 0 ? "k" : "r");
      set(main.x + r, top - 1 - r, "k");
      set(main.x + main.w - 1 - r, top - 1 - r, "k");
    }
    flagBase = { x: cx, y: top - 1 - Math.min(half, 6) };
  } else if (kind === "dome") {
    const rad = Math.max(2, Math.floor(main.w / 3));
    for (let j = 0; j <= rad; j++) {
      const span = Math.round(Math.sqrt(rad * rad - j * j));
      rect(cx - span, top - 1 - j, span * 2, 1, j === rad ? "k" : "r");
      set(cx - span, top - 1 - j, "k");
      set(cx + span - 1, top - 1 - j, "k");
    }
    flagBase = { x: cx, y: top - 2 - rad };
  } else {
    rect(main.x, top - 1, main.w, 1, "r");
    rect(main.x, top - 2, main.w, 1, "k");
    if (kind === "antenna") {
      rect(cx, top - 7, 1, 5, "k");
      set(cx, top - 8, "a");
    } else if (kind === "garden") {
      for (let i = main.x + 1; i < main.x + main.w - 1; i += 3) {
        set(i, top - 3, "e");
        set(i + 1, top - 3, "e");
      }
    }
    flagBase = { x: main.x + 1, y: top - 2 };
  }
  // flag of the country on a pole
  const flag = input.flag ?? null;
  if (flag && flag.length > 0) {
    const fx = flagBase.x;
    const fy = Math.max(1, flagBase.y - 5);
    rect(fx, fy, 1, flagBase.y - fy + 1, "p");
    const colors = flag.slice(0, 3);
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 4; i++) {
        const n = input.flagVertical
          ? Math.min(colors.length - 1, Math.floor((i * colors.length) / 4))
          : Math.min(colors.length - 1, j % colors.length);
        set(fx + 1 + i, fy + j, ["x", "y", "z"][n]!);
      }
    }
  }
  // decoration on the ground beside the main body
  const deco = input.deco ?? "none";
  const left = list.reduce((m, b) => Math.min(m, b.x), main.x);
  const right = list.reduce((m, b) => Math.max(m, b.x + b.w), main.x + main.w);
  const spots = [left - 3, right + 1].filter((x) => x >= 0 && x + 2 <= W);
  for (const sx of spots) {
    if (deco === "trees") {
      rect(sx, 21, 3, 3, "e");
      rect(sx + 1, 24, 1, 2, "m");
    } else if (deco === "fountain") {
      rect(sx, 24, 3, 2, "b");
      set(sx + 1, 23, "b");
    } else if (deco === "statue") {
      rect(sx + 1, 21, 1, 3, "m");
      rect(sx, 24, 3, 2, "k");
    } else if (deco === "flags") {
      rect(sx + 1, 19, 1, 7, "p");
      rect(sx + 2, 19, 2, 2, "s");
    } else if (deco === "lights") {
      rect(sx + 1, 21, 1, 5, "p");
      set(sx + 1, 20, "l");
    }
  }
  // ground line
  rect(0, 26, W, 1, ".");

  const pick = <T extends readonly string[]>(list: T, i: number | undefined) => list[Math.abs(i ?? 0) % list.length]!;
  const fc = flag ?? [];
  return {
    grid: px.map((row) => row.join("")),
    palette: {
      k: OUTLINE,
      w: pick(HQ_WALL_COLORS, input.wall),
      d: "rgba(0,0,0,0.18)",
      r: pick(HQ_ROOF_COLORS, input.roof),
      s: pick(HQ_SIGN_COLORS, input.sign),
      t: OUTLINE,
      g: "#62c8ff",
      G: "#c9f1ff",
      o: "#5a3b26",
      p: "#8a8f99",
      a: "#ff4757",
      e: "#4caf50",
      b: "#4a9fe0",
      m: "#a7a29a",
      l: "#ffe08a",
      x: fc[0] ?? "#ffffff",
      y: fc[1] ?? fc[0] ?? "#ffffff",
      z: fc[2] ?? fc[1] ?? fc[0] ?? "#ffffff",
    },
  };
}

/** A small pixel flag (6×4) from up to three colors, horizontal or vertical stripes. */
export function flagArt(colors: readonly string[], vertical = false): PixelArt {
  const c = colors.slice(0, 3);
  const n = Math.max(1, c.length);
  const keys = ["x", "y", "z"] as const;
  const grid = Array.from({ length: 4 }, (_, y) =>
    Array.from({ length: 6 }, (_, x) => keys[Math.min(n - 1, Math.floor((vertical ? x / 6 : y / 4) * n))]).join(""),
  );
  return {
    grid,
    palette: { x: c[0] ?? "#ffffff", y: c[1] ?? c[0] ?? "#ffffff", z: c[2] ?? c[1] ?? c[0] ?? "#ffffff" },
  };
}
