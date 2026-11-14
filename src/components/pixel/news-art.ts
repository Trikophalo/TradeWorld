import type { PixelArt, PixelGrid } from "./pixel-icon";

/*
 * Pixel art for the hourly news show "NEXA Nachrichten": the anchor Mr. Doodle Dangle, his studio and the retro TV
 * around it. The big sprites are larger than the 16×16 icons and use more colours, so they have their own shape test
 * (news-art.test.ts); the small topic icons follow the icon rules and are registered in ALL_PIXEL_ART.
 * Pure data and pure functions: no React, no clock, no randomness (the skyline and the TV snow use a fixed seed).
 */

/** Mid-tone outline of the icon set (same value as in art.ts): readable on dark and on light surfaces. */
const OUTLINE = "#5d6679";

/**
 * Broadcast colours. The picture on the TV is the same in both themes, like a real broadcast, so on-screen graphics
 * (captions, the speech bubble, the title card) take their colours from here instead of the theme tokens.
 */
export const TV = {
  /** The glass of a switched-off tube and every dark outline on screen. */
  ink: "#0b0e1a",
  /** Studio wall. */
  wall: "#1c2444",
  /** Caption bars. */
  bar: "#141a33",
  /** Lines and inactive marks on caption bars. */
  dim: "#56608a",
  /** Speech bubble and bright captions. */
  paper: "#fbf6e9",
  /** Secondary text on dark captions. */
  mist: "#b9c1da",
  /** Station colour. */
  red: "#e2475d",
  gold: "#ffd15c",
} as const;

// ---------------------------------------------------------------- helpers

export interface PixelPatch {
  readonly x: number;
  readonly y: number;
  readonly rows: readonly string[];
}

/** Overlays patches onto a grid; a space in a patch keeps the pixel below. */
export function patchGrid(grid: PixelGrid, patches: readonly PixelPatch[]): string[] {
  const rows = grid.map((row) => [...row]);
  for (const patch of patches) {
    patch.rows.forEach((line, dy) => {
      const target = rows[patch.y + dy];
      if (!target) return;
      for (let dx = 0; dx < line.length; dx++) {
        const char = line[dx]!;
        if (char !== " " && patch.x + dx >= 0 && patch.x + dx < target.length) target[patch.x + dx] = char;
      }
    });
  }
  return rows.map((row) => row.join(""));
}

/** Cuts the middle `width` columns out of a grid, repeating it sideways when it is too narrow. */
export function cropCenter(grid: PixelGrid, width: number): string[] {
  const w = Math.max(1, Math.floor(width));
  return grid.map((row) => {
    const start = Math.floor((row.length - w) / 2);
    let out = "";
    for (let x = 0; x < w; x++) out += row[(((start + x) % row.length) + row.length) % row.length];
    return out;
  });
}

/** Deterministic PRNG (mulberry32): the same skyline and the same snow on every load. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function blank(width: number, height: number, fill = "."): string[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => fill));
}

function fillRect(rows: string[][], x: number, y: number, w: number, h: number, char: string): void {
  for (let yy = Math.max(0, y); yy < Math.min(rows.length, y + h); yy++) {
    const row = rows[yy]!;
    for (let xx = Math.max(0, x); xx < Math.min(row.length, x + w); xx++) row[xx] = char;
  }
}

// ---------------------------------------------------------------- the anchor

/*
 * Mr. Doodle Dangle, 40×36: an older gentleman with swept-back grey hair, bushy brows and a big grey moustache, in a
 * navy suit with a red tie and a gold pocket square. He sits behind the desk, which hides the lowest rows. One base
 * drawing plus small patches per expression, so every frame is pixel-identical outside the patch.
 */
const ANCHOR_PALETTE = {
  k: "#1b1e2b",
  H: "#f4f6fa",
  h: "#c9d0dc",
  g: "#8f99ad",
  b: "#69728a",
  s: "#efc09a",
  d: "#d39a74",
  r: "#e89f8b",
  w: "#ffffff",
  j: "#2f3f73",
  J: "#1f2b52",
  l: "#465a99",
  t: "#e2475d",
  T: "#a52d42",
  o: "#4a1a26",
  p: "#e36d7c",
  y: "#ffd15c",
} as const;

const ANCHOR_BASE = [
  ".............kkkkkkkkkk.................",
  "...........kkHHHHHHHHHhkkkk.............",
  "..........kHHHhHHHHHHHHhhhhkk...........",
  ".........kHHhgHHHHHHHhhhhhhhgk..........",
  ".........khhhgHHHHhhhHHhhhhggk..........",
  ".........khhgHHHhhhhhhhhhhhggk..........",
  "..........kghsssssssssshhhhhgk..........",
  "..........kghssssssssssssshhgk..........",
  "..........kghsssssssssssssshgk..........",
  "..........kghsbbbbssssbbbbshgk..........",
  ".........kshssswksssssswkssshsk.........",
  ".........kshssskksssdsskkssshsk.........",
  ".........ksssssddsssdssddsssssk.........",
  ".........ksssrrssssrrdsssrrsssk.........",
  "..........kssrrsssdrrdsssrrssk..........",
  "..........kssssHHHHHHHHHHssssk..........",
  "..........ksshhHHHHhhHHHHhhssk..........",
  "..........kssghhgggggggghhgssk..........",
  "...........ksggsssddddsssggsk...........",
  "............kdssssssssssssdk............",
  ".............kdssssssssssdk.............",
  "..............kkdssssssdkk..............",
  "..............kwwddddddwwk..............",
  "........kkkkkkkwwwddddwwwkkkkkkk........",
  ".....kkkjjjjjjlwwwwttwwwwljjjjjjkkk.....",
  "...kkjjjjjjjjjllwwwttwwwlljjjjjjjjjkk...",
  "..kjjjjjjjjjjjjllwttttwlljjjjjjjjjjjjk..",
  ".kjjjjjJjjjjjjjjlltTttlljjjjjjjjJjjjjjk.",
  ".kjjjjjJjjjjjjjjllttTtlljjjyyyjjJjjjjjk.",
  ".kjjjjjJjjjjjjjjlltttTlljjjyyyjjJjjjjjk.",
  ".kjjjjjJjjjjjjjjllTtttlljjjjjjjjJjjjjjk.",
  ".kjjjjjJjjjjjjjjlltTttlljjjjjjjjJjjjjjk.",
  ".kjjjjjJjjjjjjjjjlttTtljjjjjjjjjJjjjjjk.",
  ".kjjjjjJjjjjjjjjjlltTlljjjjjjjjjJjjjjjk.",
  ".kjjjjjJjjjjjjjjjjllllyjjjjjjjjjJjjjjjk.",
  ".kjjjjjJjjjjjjjjjjjlljjjjjjjjjjjJjjjjjk.",
] as const;

export type AnchorMouth = "closed" | "half" | "open";
export type AnchorEyes = "open" | "blink" | "happy";
export type AnchorBrows = "rest" | "raised" | "cocked";
export type AnchorArm = "down" | "waveLeft" | "waveRight";

const MOUTH_PATCHES: Record<AnchorMouth, readonly PixelPatch[]> = {
  closed: [],
  half: [{ x: 15, y: 18, rows: ["ssoooooss "] }],
  open: [
    { x: 15, y: 18, rows: ["ssoooooos"] },
    { x: 16, y: 19, rows: ["soppppos"] },
  ],
};

const EYE_PATCHES: Record<AnchorEyes, readonly PixelPatch[]> = {
  open: [],
  blink: [
    { x: 15, y: 10, rows: ["ss"] },
    { x: 23, y: 10, rows: ["ss"] },
  ],
  happy: [
    { x: 14, y: 10, rows: ["skks", "kssk"] },
    { x: 22, y: 10, rows: ["skks", "kssk"] },
  ],
};

const BROW_PATCHES: Record<AnchorBrows, readonly PixelPatch[]> = {
  rest: [],
  raised: [
    { x: 14, y: 8, rows: ["bbbb", "ssss"] },
    { x: 22, y: 8, rows: ["bbbb", "ssss"] },
  ],
  // One brow up: the look he gives a player who lost money.
  cocked: [{ x: 22, y: 7, rows: ["sbbb", "bsss", "ssss"] }],
};

const WAVE_HAND = [
  "..kkkkk.",
  ".ksdsdsk",
  ".ksdsdsk",
  "kksssssk",
  "kssssssk",
  "kssssssk",
  ".kssssk.",
  ".kwwwwk.",
] as const;
const WAVE_FOREARM = ["kjjjjk", "kjjjjk", "kjjjjk", "kjjjjk", "kjjjjk"] as const;
const WAVE_UPPER_ARM = [
  "kjjjjk",
  "kjjjjk",
  "kjjjjk",
  "kjjjjk",
  "kjjjjk",
  "kjjjjk",
  "kjjjjk",
  "kjjjjk",
  "kjjjjk",
  "jjjjjk",
  "jjjjjk",
] as const;

const ARM_PATCHES: Record<AnchorArm, readonly PixelPatch[]> = {
  down: [],
  waveLeft: [
    { x: 31, y: 2, rows: WAVE_HAND },
    { x: 32, y: 10, rows: WAVE_FOREARM },
    { x: 32, y: 15, rows: WAVE_UPPER_ARM },
  ],
  waveRight: [
    { x: 32, y: 2, rows: WAVE_HAND },
    { x: 33, y: 10, rows: WAVE_FOREARM },
    { x: 32, y: 15, rows: WAVE_UPPER_ARM },
  ],
};

export interface AnchorPose {
  mouth?: AnchorMouth;
  eyes?: AnchorEyes;
  brows?: AnchorBrows;
  arm?: AnchorArm;
}

const anchorCache = new Map<string, PixelArt>();

/** One frame of the anchor. Frames are cached, so the same pose always returns the same object. */
export function anchorArt(pose: AnchorPose = {}): PixelArt {
  const { mouth = "closed", eyes = "open", brows = "rest", arm = "down" } = pose;
  const key = `${mouth}/${eyes}/${brows}/${arm}`;
  let art = anchorCache.get(key);
  if (!art) {
    art = {
      palette: ANCHOR_PALETTE,
      grid: patchGrid(ANCHOR_BASE, [
        ...BROW_PATCHES[brows],
        ...EYE_PATCHES[eyes],
        ...MOUTH_PATCHES[mouth],
        ...ARM_PATCHES[arm],
      ]),
    };
    anchorCache.set(key, art);
  }
  return art;
}

export const ANCHOR_SIZE = { width: 40, height: 36 } as const;
/** Row of the anchor sprite where the desk top begins. */
export const ANCHOR_DESK_ROW = 34;

/*
 * His hands on the desk with the script, 34×10, drawn over the desk edge. "tapUp" and "tapDown" square the pages on
 * the desk when a new story starts; "one" is the left hand alone while the other one waves.
 */
const HANDS_PALETTE = { k: "#1b1e2b", s: "#efc09a", d: "#d39a74", w: "#ffffff", g: "#b8c0d0", j: "#2f3f73" } as const;
const HANDS_EMPTY = "..................................";
const HANDS_TAP = [
  "...........kkkkkkkkkkkk...........",
  "...........kwwwwwwwwwwk...........",
  "...........kwggggggggwk...........",
  "...........kwwwwwwwwwwk...........",
  "...kkkkkkkkkwgggggwggwkkkkkkkkk...",
  "..kjjjwsssskwwwwwwwwwwksssswjjjk..",
  "..kjjjwsssskwggggggggwksssswjjjk..",
  "..kjjjwsssdkwwwwwwwwwwkdssswjjjk..",
  "...kkkkkkkkkkkkkkkkkkkkkkkkkkkk...",
] as const;

export const HANDS = {
  rest: {
    palette: HANDS_PALETTE,
    grid: [
      HANDS_EMPTY,
      HANDS_EMPTY,
      HANDS_EMPTY,
      "..........kkkkkkkkkkkkkk..........",
      ".........kwwwwwwwwwwwwwwk.........",
      ".kkkkkkkkkwggggggwwggggwkkkkkkkkk.",
      "kjjjwsssskwwwwwwwwwwwwwwksssswjjjk",
      "kjjjwsssdkwgggggggwwgggwkdssswjjjk",
      "kjjjwssssskwwwwwwwwwwwwkssssswjjjk",
      ".kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.",
    ],
  },
  tapUp: { palette: HANDS_PALETTE, grid: [...HANDS_TAP, HANDS_EMPTY] },
  tapDown: { palette: HANDS_PALETTE, grid: [HANDS_EMPTY, ...HANDS_TAP] },
  one: {
    palette: HANDS_PALETTE,
    grid: [
      HANDS_EMPTY,
      HANDS_EMPTY,
      HANDS_EMPTY,
      "..........kkkkkkkkkkkkkk..........",
      ".........kwwwwwwwwwwwwwwk.........",
      ".kkkkkkkkkwggggggwwggggwk.........",
      "kjjjwsssskwwwwwwwwwwwwwwk.........",
      "kjjjwsssdkwgggggggwwgggwk.........",
      "kjjjwssssskwwwwwwwwwwwwk..........",
      ".kkkkkkkkkkkkkkkkkkkkkkk..........",
    ],
  },
} as const satisfies Record<string, PixelArt>;

// ---------------------------------------------------------------- the studio

export const SCENE_HEIGHT = 56;
/** Widest picture the backdrop can fill without repeating. */
export const SCENE_MAX_WIDTH = 160;
/** Scene row of the desk top; the anchor sits at `SCENE_DESK_ROW - ANCHOR_DESK_ROW`. */
export const SCENE_DESK_ROW = 38;

const BACKDROP_PALETTE = {
  W: TV.wall,
  V: "#161d38",
  f: "#3a4780",
  F: "#56659f",
  a: "#12173a",
  b: "#1a2150",
  c: "#262b66",
  e: "#3a367c",
  x: "#dfe6ff",
  m: "#f3ecc8",
  B: "#161b40",
  D: "#0d1128",
  y: "#ffd98a",
  n: "#7fd8ff",
  q: "#27305e",
  r: "#ff6170",
} as const;

/**
 * The wall behind the desk: one long window onto the city at night. `frame` 1 switches a few windows and the
 * beacon on the tower, so the city lives a little.
 */
function buildBackdrop(frame: 0 | 1): PixelArt {
  const width = SCENE_MAX_WIDTH;
  const rows = blank(width, SCENE_HEIGHT, "W");
  const top = 3;
  const bottom = 35; // last sky row
  // Sky: four bands, brightest at the horizon.
  fillRect(rows, 0, top, width, 10, "a");
  fillRect(rows, 0, top + 10, width, 9, "b");
  fillRect(rows, 0, top + 19, width, 8, "c");
  fillRect(rows, 0, top + 27, width, bottom - top - 26, "e");
  // Dithered seams between the bands.
  for (const [y, char] of [
    [top + 10, "a"],
    [top + 19, "b"],
    [top + 27, "c"],
  ] as const) {
    for (let x = y % 2; x < width; x += 2) rows[y]![x] = char;
  }

  const random = prng(20261114);
  // Stars in the upper sky.
  for (let i = 0; i < 46; i++) {
    const x = Math.floor(random() * width);
    const y = top + Math.floor(random() * 13);
    rows[y]![x] = random() < 0.5 ? "x" : "f";
  }
  // Moon.
  const moon = [".mmm.", "mmmmm", "mmmmm", "mmmmm", ".mmm."];
  moon.forEach((line, dy) => [...line].forEach((char, dx) => char !== "." && (rows[top + 2 + dy]![82 + dx] = char)));
  rows[top + 3]![85] = "F";
  rows[top + 5]![83] = "F";

  // Far skyline: low, soft silhouettes.
  let x = -3;
  while (x < width) {
    const w = 5 + Math.floor(random() * 7);
    const h = 5 + Math.floor(random() * 9);
    fillRect(rows, x, bottom + 1 - h, w, h, "B");
    for (let wy = bottom + 2 - h; wy < bottom; wy += 2) {
      for (let wx = x + 1; wx < x + w - 1; wx += 2) {
        if (wx >= 0 && wx < width && random() < 0.22) rows[wy]![wx] = "q";
      }
    }
    x += w + (random() < 0.3 ? 1 : 0);
  }
  // Near skyline: taller towers with lit windows.
  x = -2;
  let index = 0;
  while (x < width) {
    const w = 6 + Math.floor(random() * 6);
    const tall = random() < 0.28;
    const h = tall ? 17 + Math.floor(random() * 6) : 7 + Math.floor(random() * 8);
    const y0 = bottom + 1 - h;
    fillRect(rows, x, y0, w, h, "D");
    if (tall) {
      // A mast with a beacon that blinks.
      const mx = x + Math.floor(w / 2);
      if (mx >= 0 && mx < width) {
        rows[y0 - 1]![mx] = "D";
        rows[y0 - 2]![mx] = "D";
        rows[y0 - 3]![mx] = (index + frame) % 2 === 0 ? "r" : "D";
      }
    }
    for (let wy = y0 + 2; wy < bottom; wy += 2) {
      for (let wx = x + 1; wx < x + w - 1; wx += 2) {
        if (wx < 0 || wx >= width) continue;
        const roll = random();
        const flicker = random() < 0.1;
        const lit = roll < 0.42 !== (flicker && frame === 1);
        rows[wy]![wx] = lit ? (roll < 0.07 ? "n" : "y") : "q";
      }
    }
    x += w + 1 + Math.floor(random() * 3);
    index++;
  }

  // Window frame: rail, sill and a mullion every 40 pixels.
  fillRect(rows, 0, top - 1, width, 1, "F");
  fillRect(rows, 0, bottom + 1, width, 1, "F");
  fillRect(rows, 0, bottom + 2, width, 1, "f");
  for (let mx = 19; mx < width; mx += 40) {
    fillRect(rows, mx, top, 1, bottom - top + 1, "f");
    fillRect(rows, mx + 1, top, 1, bottom - top + 1, "V");
  }
  // The wall below the sill gets darker towards the floor.
  fillRect(rows, 0, bottom + 6, width, SCENE_HEIGHT - bottom - 6, "V");
  return { palette: BACKDROP_PALETTE, grid: rows.map((row) => row.join("")) };
}

export const BACKDROP: readonly [PixelArt, PixelArt] = [buildBackdrop(0), buildBackdrop(1)];

/** Lighting rig above the set, 32×8, repeated across the picture. `on` lights the lamps. */
const RIG_GRID = [
  "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk",
  "gkgkgkgkgkgkgkgkgkgkgkgkgkgkgkgk",
  "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk",
  ".....kk..............kk.........",
  "....kggk............kggk........",
  "...kggggk..........kggggk.......",
  "...kLLLLk..........kLLLLk.......",
  "....kkkk............kkkk........",
] as const;

export const LIGHT_RIG = {
  on: { palette: { k: TV.ink, g: "#3a4468", L: "#fff3c4" }, grid: RIG_GRID },
  off: { palette: { k: TV.ink, g: "#3a4468", L: "#56608a" }, grid: RIG_GRID },
} as const satisfies Record<string, PixelArt>;

const DESK_PALETTE = {
  T: "#f4f6fb",
  t: "#c9d0e0",
  k: TV.ink,
  f: "#27336e",
  F: "#1c2654",
  a: "#62e0ff",
  r: TV.red,
  K: "#0d1126",
} as const;

/** The news desk, 18 rows, any width: a white top with a light strip under its edge and a navy front. */
export function deskArt(width: number): PixelArt {
  const w = Math.max(1, Math.floor(width));
  return {
    palette: DESK_PALETTE,
    grid: [..."TtkafffffffffffrFK"].map((char) => char.repeat(w)),
  };
}
export const DESK_HEIGHT = 18;

/* A small and a big pixel alphabet, only the letters the desk sign needs. */
const FONT_SMALL: Record<string, readonly string[]> = {
  N: ["x..x", "xx.x", "x.xx", "x..x", "x..x"],
  A: [".x.", "x.x", "xxx", "x.x", "x.x"],
  C: [".xx", "x..", "x..", "x..", ".xx"],
  H: ["x.x", "x.x", "xxx", "x.x", "x.x"],
  R: ["xx.", "x.x", "xx.", "x.x", "x.x"],
  I: ["x", "x", "x", "x", "x"],
  T: ["xxx", ".x.", ".x.", ".x.", ".x."],
  E: ["xxx", "x..", "xx.", "x..", "xxx"],
};
const FONT_BIG: Record<string, readonly string[]> = {
  N: ["x...x", "xx..x", "xx..x", "x.x.x", "x..xx", "x..xx", "x...x"],
  E: ["xxxxx", "x....", "x....", "xxxx.", "x....", "x....", "xxxxx"],
  X: ["x...x", "x...x", ".x.x.", "..x..", ".x.x.", "x...x", "x...x"],
  A: [".xxx.", "x...x", "x...x", "xxxxx", "x...x", "x...x", "x...x"],
};

/** Draws `text` (each font pixel `zoom` art pixels big) and returns the column after its last pixel. */
function drawText(
  rows: string[][],
  text: string,
  font: Record<string, readonly string[]>,
  x: number,
  y: number,
  char: string,
  zoom = 1,
): number {
  let cursor = x;
  for (const letter of text) {
    const glyph = font[letter];
    if (!glyph) continue;
    glyph.forEach((line, dy) =>
      [...line].forEach((cell, dx) => {
        if (cell === "x") fillRect(rows, cursor + dx * zoom, y + dy * zoom, zoom, zoom, char);
      }),
    );
    cursor += ((glyph[0]?.length ?? 0) + 1) * zoom;
  }
  return cursor - zoom;
}

const SIGN_COIN = ["..oooo..", ".oyyyyo.", "oyhyyydo", "oyhyyydo", "oyyyyydo", "oyyyyddo", ".oyyddo.", "..oooo.."];

/** The sign on the front of the desk, 8 rows: the NEXA coin and the name of the show (`short`: only "NEXA"). */
function buildDeskSign(short: boolean): PixelArt {
  const rows = blank(90, 8, ".");
  SIGN_COIN.forEach((line, dy) => [...line].forEach((cell, dx) => cell !== "." && (rows[dy]![dx] = cell)));
  let x = drawText(rows, "NEXA", FONT_BIG, 10, 0, "w");
  if (!short) {
    fillRect(rows, x + 2, 0, 1, 7, "r");
    x = drawText(rows, "NACHRICHTEN", FONT_SMALL, x + 5, 2, "m");
  }
  return {
    palette: { o: "#7a4a00", y: TV.gold, h: "#fff3c4", d: "#e09a1f", w: "#ffffff", r: TV.red, m: TV.mist },
    grid: rows.map((row) => row.slice(0, x).join("")),
  };
}
export const DESK_SIGN: PixelArt = buildDeskSign(false);
/** For pictures too narrow for the whole name. */
export const DESK_SIGN_SHORT: PixelArt = buildDeskSign(true);
/** Row of the desk where the sign starts. */
export const DESK_SIGN_ROW = 6;

/**
 * The logo of the show for the title card, 47 wide: "NEXA" in double-size letters with a thin red drop shadow
 * (15 rows) and "NACHRICHTEN" (5 rows).
 */
function buildTitle(): { name: PixelArt; word: PixelArt } {
  const name = blank(47, 15, ".");
  drawText(name, "NEXA", FONT_BIG, 1, 1, "r", 2);
  drawText(name, "NEXA", FONT_BIG, 0, 0, "w", 2);
  const word = blank(47, 5, ".");
  drawText(word, "NACHRICHTEN", FONT_SMALL, 0, 0, "y");
  return {
    name: { palette: { w: TV.paper, r: TV.red }, grid: name.map((row) => row.join("")) },
    word: { palette: { y: TV.gold }, grid: word.map((row) => row.join("")) },
  };
}
export const SHOW_TITLE = buildTitle();

/** Monitor over the anchor's shoulder that shows the topic icon (16×16) of the story, 22×22. */
export const TOPIC_SCREEN: PixelArt = {
  palette: { k: TV.ink, f: "#56659f", F: "#8fa0d8", s: "#101634", g: "#3a4780" },
  grid: [
    "..........gg..........",
    "..........gg..........",
    ".kkkkkkkkkkkkkkkkkkkk.",
    "kFFFFFFFFFFFFFFFFFFFFk",
    "kFssssssssssssssssssfk",
    "kFssssssssssssssssssfk",
    "kFssssssssssssssssssfk",
    "kFssssssssssssssssssfk",
    "kFssssssssssssssssssfk",
    "kFssssssssssssssssssfk",
    "kFssssssssssssssssssfk",
    "kFssssssssssssssssssfk",
    "kFssssssssssssssssssfk",
    "kFssssssssssssssssssfk",
    "kFssssssssssssssssssfk",
    "kFssssssssssssssssssfk",
    "kFssssssssssssssssssfk",
    "kFssssssssssssssssssfk",
    "kFssssssssssssssssssfk",
    "kFssssssssssssssssssfk",
    "kffffffffffffffffffffk",
    ".kkkkkkkkkkkkkkkkkkkk.",
  ],
};
/** Where the 16×16 topic icon sits inside TOPIC_SCREEN. */
export const TOPIC_SCREEN_INSET = { x: 3, y: 4 } as const;

/** His coffee, 9×11 with steam; two frames. */
const MUG_PALETTE = { k: "#1b1e2b", w: "#f4f6fb", t: "#c9d0e0", r: TV.red, s: "#8f99ad" } as const;
export const MUG: readonly [PixelArt, PixelArt] = [
  {
    palette: MUG_PALETTE,
    grid: [
      "..s......",
      "...s.s...",
      "..s...s..",
      "...s.s...",
      ".kkkkkk..",
      ".kwwwwtkk",
      ".kwrrwtk.k",
      ".kwrrwtk.k",
      ".kwwwwtkk",
      ".kwwwwtk.",
      "..kkkkk..",
    ].map((row) => row.slice(0, 9)),
  },
  {
    palette: MUG_PALETTE,
    grid: [
      "...s.s...",
      "..s...s..",
      "...s.s...",
      "..s...s..",
      ".kkkkkk..",
      ".kwwwwtkk",
      ".kwrrwtk.k",
      ".kwrrwtk.k",
      ".kwwwwtkk",
      ".kwwwwtk.",
      "..kkkkk..",
    ].map((row) => row.slice(0, 9)),
  },
];

/** Tails of the speech bubble, in the bubble's colours. */
export const BUBBLE_TAIL = {
  down: {
    palette: { k: TV.ink, w: TV.paper },
    grid: ["kwwwwwk", "kwwwwwk", ".kwwwk.", ".kwwk..", "..kwk..", "..kk...", "..k...."],
  },
  left: {
    palette: { k: TV.ink, w: TV.paper },
    grid: ["....kkk", "..kkwww", "kkwwwww", "..kkwww", "....kkk"],
  },
} as const satisfies Record<string, PixelArt>;

/** TV snow, 80×64 at double pixel size: two frames of sparse noise over the dark tube. */
function buildSnow(seed: number): PixelArt {
  const random = prng(seed);
  const rows = blank(80, 64, ".");
  for (const row of rows) {
    for (let x = 0; x < row.length; x++) {
      const roll = random();
      row[x] = roll < 0.2 ? "a" : roll < 0.36 ? "b" : roll < 0.46 ? "c" : ".";
    }
  }
  return { palette: { a: "#3a4060", b: "#8088a8", c: "#e6e9f5" }, grid: rows.map((row) => row.join("")) };
}
export const SNOW: readonly [PixelArt, PixelArt] = [buildSnow(7), buildSnow(1312)];

// ---------------------------------------------------------------- the TV set

/** Rabbit-ear antenna, 35×14. Token colours: the set follows the theme, only the picture does not. */
export const ANTENNA: PixelArt = {
  palette: { k: "var(--line-2)", m: "var(--fg-3)", b: "var(--bg-3)" },
  grid: [
    "mmm.............................mmm",
    "mmm.............................mmm",
    ".mmm...........................mmm.",
    "..mmm.........................mmm..",
    "...mmm.......................mmm...",
    "....mmm.....................mmm....",
    ".....mmm...................mmm.....",
    "......mmm.................mmm......",
    ".......mmm...............mmm.......",
    "........mmm.............mmm........",
    ".........mmm...........mmm.........",
    "..........mmm.kkkkkkk.mmm..........",
    "...........mkkbbbbbbbkkm...........",
    "...........kbbbbbbbbbbbk...........",
  ],
};

/** Dial on the TV, 12×12, two positions. */
export const KNOB: readonly [PixelArt, PixelArt] = [
  {
    palette: { k: "var(--line-2)", b: "var(--bg-1)", m: "var(--fg-3)" },
    grid: [
      "....kkkk....",
      "..kkbbbbkk..",
      ".kbbbmmbbbk.",
      ".kbbbmmbbbk.",
      "kbbbbmmbbbbk",
      "kbbbbmmbbbbk",
      "kbbbbbbbbbbk",
      "kbbbbbbbbbbk",
      ".kbbbbbbbbk.",
      ".kbbbbbbbbk.",
      "..kkbbbbkk..",
      "....kkkk....",
    ],
  },
  {
    palette: { k: "var(--line-2)", b: "var(--bg-1)", m: "var(--fg-3)" },
    grid: [
      "....kkkk....",
      "..kkbbbbkk..",
      ".kbbbbbbbbk.",
      ".kbbbbbbmbk.",
      "kbbbbbbmmbbk",
      "kbbbbbmmbbbk",
      "kbbbbbmbbbbk",
      "kbbbbbbbbbbk",
      ".kbbbbbbbbk.",
      ".kbbbbbbbbk.",
      "..kkbbbbkk..",
      "....kkkk....",
    ],
  },
];

// ---------------------------------------------------------------- topic icons (16×16, icon rules)

const mic: PixelArt = {
  palette: { k: OUTLINE, g: "#c9d3e3", w: "#ffffff", r: TV.red },
  grid: [
    "................",
    "......kkkk......",
    ".....kggggk.....",
    ".....kgwggk.....",
    ".....kgwggk.....",
    ".....kggggk.....",
    ".....krrrrk.....",
    "...k.kggggk.k...",
    "...k..kkkk..k...",
    "...k........k...",
    "....k......k....",
    ".....kkkkkk.....",
    ".......kk.......",
    ".......kk.......",
    ".....kkkkkk.....",
    "................",
  ],
};

const chartDown: PixelArt = {
  palette: { k: OUTLINE, r: "#ff6170", d: "#b8323f" },
  grid: [
    "................",
    ".k..............",
    ".k.rr...........",
    ".k.rrr....r.....",
    ".k..rrr..rrr....",
    ".k...rrrrrrrr...",
    ".k....rrr..rrr..",
    ".k..........rrr.",
    ".k.......r...rr.",
    ".k.......rr..rr.",
    ".k.......rrrrrr.",
    ".k........rrrrr.",
    ".k..............",
    ".kkkkkkkkkkkkkk.",
    "................",
    "................",
  ],
};

const crown: PixelArt = {
  palette: { o: "#7a4a00", y: "#ffd15c", h: "#fff3c4", d: "#e09a1f", r: "#ff6170" },
  grid: [
    "................",
    "................",
    "..o....oo....o..",
    ".oyo..oyyo..oyo.",
    ".oyo..oyyo..oyo.",
    "..oyo.oyyo.oyo..",
    "..oyyoyyyyoyyo..",
    "..oyhyyyyyyyyo..",
    "..oyhyyyyyyydo..",
    "..oyyryyrryydo..",
    "..oyyryyrryddo..",
    "..oyyyyyyydddo..",
    "..oooooooooooo..",
    "................",
    "................",
    "................",
  ],
};

const siren: PixelArt = {
  palette: { k: OUTLINE, r: "#ff6170", h: "#ffc2c8", g: "#c9d3e3", y: "#ffd15c" },
  grid: [
    "................",
    ".y.....yy.....y.",
    "..y....yy....y..",
    "...y........y...",
    ".....kkkkkk.....",
    "....krrrrrrk....",
    "...krrhrrrrrk...",
    "...krhrrrrrrk...",
    "...krhrrrrrrk...",
    "...krrrrrrrrk...",
    "...krrrrrrrrk...",
    "..kkkkkkkkkkkk..",
    "..kggggggggggk..",
    "..kkkkkkkkkkkk..",
    "................",
    "................",
  ],
};

const rocket: PixelArt = {
  palette: { k: OUTLINE, w: "#f4f6fb", c: "#62e0ff", r: "#ff6170", y: "#ffd15c", o: "#ff9a52" },
  grid: [
    ".......kk.......",
    "......kwwk......",
    ".....kwwwwk.....",
    ".....kwccwk.....",
    ".....kwccwk.....",
    ".....kwwwwk.....",
    ".....kwwwwk.....",
    "....kkwwwwkk....",
    "...krkwwwwkrk...",
    "...krkwwwwkrk...",
    "...kkkkkkkkkk...",
    "......kyyk......",
    "......oyyo......",
    ".......yy.......",
    ".......oo.......",
    "................",
  ],
};

const candles: PixelArt = {
  palette: { g: "#2fd98c", r: "#ff6170", k: OUTLINE },
  grid: [
    "................",
    "....g...........",
    "....g.....g.....",
    "...ggg....g.....",
    "...ggg...ggg....",
    "...ggg...ggg....",
    "...ggg...ggg..r.",
    "...ggg...ggg..r.",
    "....g.....g..rrr",
    "....g..r..g..rrr",
    ".......r.....rrr",
    "......rrr.....r.",
    "......rrr.....r.",
    "......rrr.......",
    ".......r........",
    "kkkkkkkkkkkkkkkk",
  ],
};

const factory: PixelArt = {
  palette: { k: OUTLINE, w: "#c9d3e3", y: "#ffd15c", g: "#8f9bb3", d: "#46597a" },
  grid: [
    "...........gg...",
    "..........gg.g..",
    "............g...",
    "...........kkk..",
    "...........kwk..",
    "...........kwk..",
    ".k...k...k.kwk..",
    ".kk..kk..kkkwk..",
    ".kwk.kwk.kwkwk..",
    ".kwwkkwwkkwwwkk.",
    ".kwwwwwwwwwwwwk.",
    ".kwyywyywyywwwk.",
    ".kwyywyywyywddk.",
    ".kwwwwwwwwwwddk.",
    ".kkkkkkkkkkkkkk.",
    "................",
  ],
};

const globe: PixelArt = {
  palette: { k: OUTLINE, b: "#4f8cff", g: "#2fd98c", h: "#9cc2ff" },
  grid: [
    "................",
    ".....kkkkkk.....",
    "...kkbhggbbkk...",
    "..kbhbgggbbbbk..",
    "..kbhggggbbbbk..",
    ".kbbbggggbbgbbk.",
    ".kbbbbgggbbggbk.",
    ".kbbbbbgbbbgggk.",
    ".kbbbbbbbbbgggk.",
    ".kbggbbbbbbbggk.",
    ".kbgggbbbbbbbbk.",
    "..kgggbbbbbbbk..",
    "..kbggbbbbbbbk..",
    "...kkbbbbbbkk...",
    ".....kkkkkk.....",
    "................",
  ],
};

const clipboard: PixelArt = {
  palette: { k: OUTLINE, w: "#f4f6fb", g: "#2fd98c", y: "#ffd15c", l: "#aab6cc" },
  grid: [
    "................",
    "......kkkk......",
    "...kkkkyykkkk...",
    "...kwwkkkkwwk...",
    "...kwwwwwwwwk...",
    "...kwgwllllwk...",
    "...kwwwwwwwwk...",
    "...kwgwllllwk...",
    "...kwwwwwwwwk...",
    "...kwgwlllwwk...",
    "...kwwwwwwwwk...",
    "...kwgwllllwk...",
    "...kwwwwwwwwk...",
    "...kkkkkkkkkk...",
    "................",
    "................",
  ],
};

const cryptoCoin: PixelArt = {
  palette: { o: "#1d3a6b", c: "#62e0ff", h: "#d6f6ff", d: "#2a9fd6" },
  grid: [
    ".....oooooo.....",
    "...ooccccccoo...",
    "..ochhcccccco...",
    ".ochccccccccdo..",
    ".ochcccooccccdo.",
    "ochcccoccocccdo.",
    "ochccoccccccccdo",
    "occccoccccccccdo",
    "occccoccccccccdo",
    "occcccoccoccccdo",
    "occccccoocccddo.",
    ".occccccccccddo.",
    ".occcccccccdddo.",
    "..occcccccdddo..",
    "...ooddddddoo...",
    ".....oooooo.....",
  ],
};

const hand: PixelArt = {
  palette: { k: OUTLINE, s: "#efc09a", d: "#d39a74", w: "#ffffff", j: "#2f3f73" },
  grid: [
    "................",
    "......kk.kk.....",
    ".....kssksskk...",
    ".....kssksskssk.",
    "...kkkssksskssk.",
    "..ksskssssssssk.",
    "..ksskssssssssk.",
    "..kssssssssssdk.",
    "...kssssssssdk..",
    "....ksssssssdk..",
    "....kssssssdk...",
    ".....ksssddk....",
    "......kwwwwk....",
    "......kjjjjk....",
    "......kjjjjk....",
    "................",
  ],
};

/** One icon per kind of story. Unknown kinds fall back to the newspaper from the main set. */
export const NEWS_KIND_ICONS = {
  intro: mic,
  loser: chartDown,
  winner: crown,
  scandal: siren,
  hype: rocket,
  stock: candles,
  sector: factory,
  world: globe,
  tasks: clipboard,
  crypto: cryptoCoin,
  outro: hand,
} as const satisfies Record<string, PixelArt>;
export type NewsKind = keyof typeof NEWS_KIND_ICONS;

/** Icons that follow the 16×16 rules, for ALL_PIXEL_ART. */
export const NEWS_ICON_ART: Record<string, PixelArt> = Object.fromEntries(
  Object.entries(NEWS_KIND_ICONS).map(([key, art]) => [`news/${key}`, art]),
);

/** The large sprites, for the showcase and the shape test. */
export const NEWS_STUDIO_ART: Record<string, PixelArt> = {
  "anchor/idle": anchorArt(),
  "anchor/half": anchorArt({ mouth: "half" }),
  "anchor/open": anchorArt({ mouth: "open", brows: "raised" }),
  "anchor/blink": anchorArt({ eyes: "blink" }),
  "anchor/cocked": anchorArt({ brows: "cocked", mouth: "half" }),
  "anchor/happy": anchorArt({ eyes: "happy" }),
  "anchor/wave-left": anchorArt({ eyes: "happy", arm: "waveLeft" }),
  "anchor/wave-right": anchorArt({ eyes: "happy", arm: "waveRight" }),
  "hands/rest": HANDS.rest,
  "hands/tap-up": HANDS.tapUp,
  "hands/tap-down": HANDS.tapDown,
  "hands/one": HANDS.one,
  "backdrop/0": BACKDROP[0],
  "backdrop/1": BACKDROP[1],
  "rig/on": LIGHT_RIG.on,
  "rig/off": LIGHT_RIG.off,
  desk: deskArt(64),
  "desk-sign": DESK_SIGN,
  "desk-sign/short": DESK_SIGN_SHORT,
  "title/name": SHOW_TITLE.name,
  "title/word": SHOW_TITLE.word,
  "topic-screen": TOPIC_SCREEN,
  "mug/0": MUG[0],
  "mug/1": MUG[1],
  "tail/down": BUBBLE_TAIL.down,
  "tail/left": BUBBLE_TAIL.left,
  "snow/0": SNOW[0],
  "snow/1": SNOW[1],
  antenna: ANTENNA,
  "knob/0": KNOB[0],
  "knob/1": KNOB[1],
};
