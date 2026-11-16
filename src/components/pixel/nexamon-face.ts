import type { NexamonArt, NexamonCard, NexamonRarity } from "@/config/nexamon/types";
import { NEXAMON_CARD_SIZE } from "@/config/nexamon/types";
import { drawMicroTextCentered } from "./nexamon-font";
import {
  bayer,
  bevelRect,
  blitArt,
  blitGrid,
  createRaster,
  ditherRect,
  fillRect,
  isOpaque,
  mixHex,
  roundCorners,
  setPixel,
  strokeRect,
  validateArt,
  type Raster,
} from "./nexamon-raster";
import { GOLD_INK, PRISM_INKS, rarityMark, setSymbol, TYPE_INK, TYPE_SYMBOL, typeGlyph } from "./nexamon-symbols";

/*
 * The pixel layer of a Nexamon card (ADR-165): frame, plates, symbols and the artwork on the 72 x 100 canvas.
 * Text is not part of it; the component lays real text over the canvas using the boxes of FACE_LAYOUT.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The three frame layouts: common and rare, ultra (art breaks out), prisma and legendary (full art). */
export type FaceLayoutKind = "classic" | "breakout" | "full";

export interface FaceLayout {
  kind: FaceLayoutKind;
  /** Where the artwork is drawn. */
  art: { x: number; y: number };
  /** The framed art window (the foil of a rare card covers exactly this). */
  window: Box;
  /** Stage marker above the name. Missing where the art takes the room: the strip carries it then. */
  stage: Box | null;
  name: Box;
  hp: Box;
  type: { x: number; y: number };
  /** The line under the art: what the card evolves from, or its type. */
  strip: Box | null;
  attackSymbol: { x: number; y: number };
  attackName: Box;
  damage: Box;
  attackText: Box;
  flavor: Box;
  set: { x: number; y: number };
  number: Box;
  rarity: { x: number; y: number };
}

const CLASSIC: FaceLayout = {
  kind: "classic",
  art: { x: 6, y: 14 },
  window: { x: 6, y: 14, w: 60, h: 40 },
  stage: { x: 5, y: 2.25, w: 36, h: 3 },
  name: { x: 5, y: 5.25, w: 35, h: 6 },
  hp: { x: 40, y: 4.25, w: 18, h: 7 },
  type: { x: 59, y: 2 },
  strip: { x: 6, y: 56, w: 60, h: 4 },
  attackSymbol: { x: 5, y: 62 },
  attackName: { x: 16, y: 63.25, w: 36, h: 6 },
  damage: { x: 52, y: 62.5, w: 15, h: 7 },
  attackText: { x: 6, y: 71.4, w: 60, h: 6 },
  flavor: { x: 7, y: 80.75, w: 58, h: 9.5 },
  set: { x: 5, y: 91 },
  number: { x: 14, y: 92.25, w: 34, h: 5 },
  rarity: { x: 62, y: 92 },
};

const BREAKOUT: FaceLayout = {
  ...CLASSIC,
  kind: "breakout",
  art: { x: 2, y: 8 },
  stage: null,
  name: { x: 5, y: 1.75, w: 35, h: 6 },
  hp: { x: 40, y: 0.75, w: 18, h: 7 },
  type: { x: 60, y: 1 },
};

const FULL: FaceLayout = {
  kind: "full",
  art: { x: 0, y: 0 },
  window: { x: 0, y: 0, w: 72, h: 100 },
  stage: { x: 6, y: 4.25, w: 36, h: 3 },
  name: { x: 6, y: 7.25, w: 34, h: 6 },
  hp: { x: 39, y: 6.25, w: 18, h: 7 },
  type: { x: 58, y: 4 },
  strip: null,
  attackSymbol: { x: 6, y: 62 },
  attackName: { x: 17, y: 63.25, w: 34, h: 6 },
  damage: { x: 51, y: 62.5, w: 15, h: 7 },
  attackText: { x: 6, y: 71.4, w: 60, h: 6 },
  flavor: { x: 6, y: 80.6, w: 60, h: 7.9 },
  set: { x: 6, y: 90 },
  number: { x: 15, y: 91.25, w: 34, h: 5 },
  rarity: { x: 61, y: 91 },
};

export const FACE_LAYOUT: Record<NexamonRarity, FaceLayout> = {
  common: CLASSIC,
  rare: CLASSIC,
  ultra: BREAKOUT,
  prisma: FULL,
  legendary: FULL,
};

/** Plates of the full-art layouts (name, attack, flavour, footer), shared by prisma and legendary. */
const FULL_PLATES: readonly Box[] = [
  { x: 4, y: 3, w: 64, h: 11 },
  { x: 4, y: 60, w: 64, h: 18 },
  { x: 4, y: 79, w: 64, h: 10 },
  { x: 4, y: 89, w: 64, h: 8 },
];

const { width: W, height: H } = NEXAMON_CARD_SIZE;

/** Re-inks the silhouette after the corners were cut, so the stair-steps keep their outline. */
function outlineEdge(r: Raster, hex: string): void {
  const edge: [number, number][] = [];
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++)
      if (
        isOpaque(r, x, y) &&
        !(isOpaque(r, x - 1, y) && isOpaque(r, x + 1, y) && isOpaque(r, x, y - 1) && isOpaque(r, x, y + 1))
      )
        edge.push([x, y]);
  for (const [x, y] of edge) setPixel(r, x, y, hex);
}

/** Speckled paper for the text boxes. */
function paperRect(r: Raster, box: Box, paper: string, shade: string): void {
  for (let y = box.y; y < box.y + box.h; y++)
    for (let x = box.x; x < box.x + box.w; x++) setPixel(r, x, y, (x * 7 + y * 13) % 11 === 0 ? shade : paper);
}

/** Artwork of a card without one: the type glyph, large, on a dithered field in the type colours. */
function drawPlaceholderArt(r: Raster, box: Box, card: Pick<NexamonCard, "type">): void {
  const ink = TYPE_INK[card.type];
  ditherRect(r, box.x, box.y, box.w, box.h, [ink.light, ink.base, ink.dark, ink.deep]);
  const scale = box.h >= 80 ? 8 : 5;
  const glyph = typeGlyph(card.type, ink.pale);
  const gx = box.x + Math.round((box.w - 5 * scale) / 2);
  const gy = box.y + Math.round((Math.min(box.h, 56) - 5 * scale) / 2) + (box.h >= 80 ? 14 : 0);
  glyph.grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== "#") continue;
      fillRect(r, gx + x * scale + 1, gy + y * scale + 1, scale, scale, ink.deep, 0.5);
    }
  });
  glyph.grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++)
      if (row[x] === "#") fillRect(r, gx + x * scale, gy + y * scale, scale, scale, ink.pale, 0.9);
  });
}

function drawArt(r: Raster, layout: FaceLayout, card: Pick<NexamonCard, "type" | "rarity">, art?: NexamonArt): void {
  if (art && validateArt(art, card.rarity).length === 0) blitArt(r, art, layout.art.x, layout.art.y);
  else drawPlaceholderArt(r, layout.window, card);
}

function drawFooterMarks(r: Raster, layout: FaceLayout, card: Pick<NexamonCard, "set" | "rarity">, ink: string): void {
  const set = setSymbol(card.set, ink);
  blitGrid(r, set.grid, set.palette, layout.set.x, layout.set.y);
  const mark = rarityMark(card.rarity, ink);
  blitGrid(r, mark.grid, mark.palette, layout.rarity.x, layout.rarity.y);
}

type FaceCard = Pick<NexamonCard, "type" | "rarity" | "set">;

function composeFramed(card: FaceCard, art: NexamonArt | undefined, layout: FaceLayout): Raster {
  const r = createRaster(W, H);
  const ink = TYPE_INK[card.type];
  const ultra = card.rarity === "ultra";

  // Frame: a dithered run from light to shadow; the ultra frame is brushed metal with diagonal bands.
  if (ultra) {
    const stops = [ink.dark, ink.base, ink.light, ink.pale, ink.light, ink.base];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const pos = (((x + y * 0.6) / 13) % 1) * (stops.length - 1);
        const base = Math.floor(pos);
        const next = pos - base > bayer(x, y) ? Math.min(stops.length - 1, base + 1) : base;
        setPixel(r, x, y, stops[next]!);
      }
  } else {
    ditherRect(r, 0, 0, W, H, [mixHex(ink.base, ink.light, 0.45), ink.base, ink.base, mixHex(ink.base, ink.dark, 0.6)]);
  }
  bevelRect(r, 1, 1, W - 2, H - 2, ultra ? "#ffffff" : ink.light, ink.dark);

  // Name bar.
  const headTop = 2;
  const headHeight = ultra ? 8 : 10;
  ditherRect(r, 3, headTop, 66, headHeight, [mixHex(ink.paper, ink.light, 0.3), ink.paper, ink.paper]);
  fillRect(r, 3, headTop + headHeight - 1, 66, 1, ink.paperShade);

  // Art window: ink line, a bright line, then the picture.
  const win = CLASSIC.window;
  strokeRect(r, win.x - 2, win.y - 2, win.w + 4, win.h + 4, ink.deep);
  const ring = card.rarity === "common" ? ink.pale : GOLD_INK.light;
  bevelRect(r, win.x - 1, win.y - 1, win.w + 2, win.h + 2, ring, card.rarity === "common" ? ink.light : GOLD_INK.base);
  ditherRect(r, win.x, win.y, win.w, win.h, [ink.pale, ink.light, ink.base, ink.dark]);

  // The line under the art, then the paper with the attack, the flavour box and the footer.
  fillRect(r, 4, 56, 64, 4, ink.dark);
  fillRect(r, 4, 59, 64, 1, ink.deep);
  paperRect(r, { x: 3, y: 60, w: 66, h: 37 }, ink.paper, ink.paperShade);
  fillRect(r, 3, 60, 66, 1, ink.paperShade);
  fillRect(r, 6, 78, 60, 1, ink.dark, 0.35);
  fillRect(r, 5, 80, 62, 11, ink.paperShade, 0.8);
  strokeRect(r, 5, 80, 62, 11, ink.dark, 0.55);

  // The artwork goes on last for the ultra cards, so it covers the name bar and the frame.
  if (ultra) {
    drawArt(r, layout, card, art);
  } else if (art && validateArt(art, card.rarity).length === 0) {
    blitArt(r, art, layout.art.x, layout.art.y);
  } else {
    drawPlaceholderArt(r, win, card);
  }

  const symbol = TYPE_SYMBOL[card.type];
  blitGrid(r, symbol.grid, symbol.palette, layout.type.x, layout.type.y);
  blitGrid(r, symbol.grid, symbol.palette, layout.attackSymbol.x, layout.attackSymbol.y);
  drawFooterMarks(r, layout, card, ink.deep);

  roundCorners(r, 3);
  outlineEdge(r, ink.deep);
  return r;
}

/** Corner ornament of the legendary frame, drawn for the top left corner and mirrored for the others. */
const GOLD_CORNER = ["lllllll", "lbbbbd.", "lbldd..", "lbdl...", "lbd.l..", "ld.....", "l......"] as const;

function composeFull(card: FaceCard, art: NexamonArt | undefined, layout: FaceLayout): Raster {
  const r = createRaster(W, H);
  const ink = TYPE_INK[card.type];
  const gold = card.rarity === "legendary";
  drawArt(r, layout, card, art);

  for (const [i, plate] of FULL_PLATES.entries()) {
    if (gold) {
      fillRect(r, plate.x, plate.y, plate.w, plate.h, GOLD_INK.plate, 0.74);
      strokeRect(r, plate.x, plate.y, plate.w, plate.h, GOLD_INK.base);
      fillRect(r, plate.x + 1, plate.y, plate.w - 2, 1, GOLD_INK.light);
      // Small studs in the corners of a plate.
      for (const [cx, cy] of [
        [plate.x, plate.y],
        [plate.x + plate.w - 1, plate.y],
        [plate.x, plate.y + plate.h - 1],
        [plate.x + plate.w - 1, plate.y + plate.h - 1],
      ] as const)
        setPixel(r, cx, cy, GOLD_INK.pale);
    } else {
      fillRect(r, plate.x, plate.y, plate.w, plate.h, ink.deep, i === 2 ? 0.5 : 0.62);
      fillRect(r, plate.x, plate.y, plate.w, 1, "#ffffff", 0.75);
      fillRect(r, plate.x, plate.y + plate.h - 1, plate.w, 1, "#ffffff", 0.3);
    }
  }

  if (gold) {
    // Three lines of gold with a dark seam, light from the top left.
    strokeRect(r, 0, 0, W, H, GOLD_INK.deep);
    bevelRect(r, 1, 1, W - 2, H - 2, GOLD_INK.pale, GOLD_INK.dark);
    bevelRect(r, 2, 2, W - 4, H - 4, GOLD_INK.light, GOLD_INK.base);
    strokeRect(r, 3, 3, W - 6, H - 6, GOLD_INK.deep, 0.85);
    const palette = { l: GOLD_INK.light, b: GOLD_INK.base, d: GOLD_INK.dark };
    const size = GOLD_CORNER.length;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const hex = palette[GOLD_CORNER[y]![x] as keyof typeof palette];
        if (!hex) continue;
        setPixel(r, 3 + x, 3 + y, hex);
        setPixel(r, W - 4 - x, 3 + y, hex);
        setPixel(r, 3 + x, H - 4 - y, hex);
        setPixel(r, W - 4 - x, H - 4 - y, hex);
      }
  } else {
    // A rainbow of single pixels runs around the card.
    strokeRect(r, 0, 0, W, H, ink.deep);
    const perimeter: [number, number][] = [];
    for (let x = 1; x < W - 1; x++) perimeter.push([x, 1]);
    for (let y = 2; y < H - 1; y++) perimeter.push([W - 2, y]);
    for (let x = W - 3; x >= 1; x--) perimeter.push([x, H - 2]);
    for (let y = H - 3; y >= 2; y--) perimeter.push([1, y]);
    perimeter.forEach(([x, y], i) => setPixel(r, x, y, PRISM_INKS[Math.floor(i / 4) % PRISM_INKS.length]!));
    strokeRect(r, 2, 2, W - 4, H - 4, "#ffffff", 0.55);
  }

  const symbol = TYPE_SYMBOL[card.type];
  blitGrid(r, symbol.grid, symbol.palette, layout.type.x, layout.type.y);
  blitGrid(r, symbol.grid, symbol.palette, layout.attackSymbol.x, layout.attackSymbol.y);
  drawFooterMarks(r, layout, card, gold ? GOLD_INK.light : "#ffffff");

  roundCorners(r, 3);
  outlineEdge(r, gold ? GOLD_INK.deep : ink.deep);
  return r;
}

/** Composes the pixel layer of a card front. Without artwork (or with a broken one) the placeholder is drawn. */
export function composeCardFace(card: FaceCard, art?: NexamonArt): Raster {
  const layout = FACE_LAYOUT[card.rarity];
  return layout.kind === "full" ? composeFull(card, art, layout) : composeFramed(card, art, layout);
}

/** Inks of the card back. */
const BACK = {
  outline: "#0b0828",
  border: "#5a3fd6",
  borderLight: "#9c86ff",
  borderDark: "#2e1c86",
  field: ["#140e4a", "#1d1570", "#2c1a8f", "#3a1f9e", "#2c1a8f", "#1d1570", "#140e4a"],
  ring: ["#1f6fd0", "#35d6c4", "#aef9ea", "#ffffff"],
  star: "#d9d2ff",
} as const;

/** The NEXA coin at native card resolution: 27 pixels across with a bold "N". */
function drawCoin(r: Raster, cx: number, cy: number): void {
  const radius = 13;
  for (let y = -radius; y <= radius; y++)
    for (let x = -radius; x <= radius; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d > radius + 0.3) continue;
      let hex: string = GOLD_INK.light;
      if (d > radius - 0.8) hex = GOLD_INK.deep;
      else if (d > radius - 2.6) hex = x + y > 0 ? GOLD_INK.dark : GOLD_INK.pale;
      else if (d > radius - 3.6) hex = GOLD_INK.base;
      else if (x + y > 9) hex = GOLD_INK.base;
      setPixel(r, cx + x, cy + y, hex);
    }
  // "N": two posts and a diagonal, three pixels thick, with a shadow to the lower right.
  const draw = (ox: number, oy: number, hex: string) => {
    for (let y = -6; y <= 6; y++) {
      fillRect(r, cx - 6 + ox, cy + y + oy, 3, 1, hex);
      fillRect(r, cx + 4 + ox, cy + y + oy, 3, 1, hex);
      fillRect(r, cx - 5 + Math.round(((y + 6) * 9) / 12) + ox, cy + y + oy, 3, 1, hex);
    }
  };
  draw(1, 1, GOLD_INK.pale);
  draw(0, 0, GOLD_INK.deep);
}

let backCache: Raster | null = null;

/** The card back: the NEXA coin inside a swirling ring of energy on a deep blue-violet field. */
export function composeCardBack(): Raster {
  if (backCache) return backCache;
  const r = createRaster(W, H);
  ditherRect(r, 0, 0, W, H, BACK.field);
  const cx = W / 2 - 0.5;
  const cy = H / 2 - 0.5;

  // Faint rays from the centre, then the ring: three spiral arms that brighten towards their crest.
  for (let y = 5; y < H - 5; y++)
    for (let x = 5; x < W - 5; x++) {
      const dx = x - cx;
      const dy = (y - cy) * 0.86;
      const d = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      if (d > 30 && Math.sin(angle * 12) > 0.55 && bayer(x, y) < 0.35) setPixel(r, x, y, BACK.borderLight, 0.35);
      const arm = Math.sin(angle * 3 - d * 0.32);
      const band = 1 - Math.abs(d - 23.5) / 8.5;
      if (band <= 0) continue;
      const power = band * (0.55 + 0.45 * arm);
      const t = bayer(x, y);
      if (power > 0.82) setPixel(r, x, y, BACK.ring[3]);
      else if (power > 0.6 + t * 0.12) setPixel(r, x, y, BACK.ring[2]);
      else if (power > 0.38 + t * 0.14) setPixel(r, x, y, BACK.ring[1]);
      else if (power > 0.16 + t * 0.2) setPixel(r, x, y, BACK.ring[0]);
    }

  // Stars: single pixels and a few small crosses, always the same.
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 46; i++) {
    const x = 6 + Math.floor(next() * (W - 12));
    const y = 6 + Math.floor(next() * (H - 12));
    const d = Math.hypot(x - cx, (y - cy) * 0.86);
    const big = next() > 0.8;
    if (d < 34) continue;
    setPixel(r, x, y, big ? "#ffffff" : BACK.star, big ? 1 : 0.8);
    if (big)
      for (const [ox, oy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        setPixel(r, x + ox, y + oy, BACK.star, 0.7);
  }

  drawCoin(r, Math.round(cx), Math.round(cy));

  // Wordmark above and below, the lower one turned around like on a playing card.
  drawMicroTextCentered(r, "NEXAMON", W / 2, 9, BACK.outline, 1);
  drawMicroTextCentered(r, "NEXAMON", W / 2, 8, "#ffe25c", 1);
  const flip = createRaster(W, 7);
  drawMicroTextCentered(flip, "NEXAMON", W / 2, 1, BACK.outline, 1);
  drawMicroTextCentered(flip, "NEXAMON", W / 2, 0, "#ffe25c", 1);
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (flip.data[i + 3]! === 0) continue;
      const hex = `#${[0, 1, 2].map((k) => flip.data[i + k]!.toString(16).padStart(2, "0")).join("")}`;
      setPixel(r, W - 1 - x, H - 9 + (0 - y) + 0, hex);
    }

  // Border: ink, three pixels of violet with a bevel, a thin gold line inside.
  strokeRect(r, 0, 0, W, H, BACK.outline);
  for (let i = 1; i <= 3; i++) strokeRect(r, i, i, W - 2 * i, H - 2 * i, BACK.border);
  bevelRect(r, 1, 1, W - 2, H - 2, BACK.borderLight, BACK.borderDark);
  bevelRect(r, 3, 3, W - 6, H - 6, BACK.borderDark, BACK.borderLight);
  strokeRect(r, 4, 4, W - 8, H - 8, GOLD_INK.base);
  for (const [x, y] of [
    [4, 4],
    [W - 5, 4],
    [4, H - 5],
    [W - 5, H - 5],
  ] as const)
    setPixel(r, x, y, GOLD_INK.pale);

  roundCorners(r, 3);
  outlineEdge(r, BACK.outline);
  backCache = r;
  return r;
}
