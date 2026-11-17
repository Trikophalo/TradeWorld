import type { NexamonArt, NexamonCard, NexamonRarity } from "@/config/nexamon/types";
import { NEXAMON_CARD_SIZE } from "@/config/nexamon/types";
import { drawMicroText, drawMicroTextCentered, microTextWidth } from "./nexamon-font";
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
import {
  DIAMOND_INK,
  GOLD_INK,
  IRON_INK,
  ONE_OF_ONE_INK,
  PRISM_INKS,
  rarityMark,
  setSymbol,
  TITANIUM_INK,
  TYPE_INK,
  TYPE_SYMBOL,
  typeGlyph,
  URANIUM_INK,
  YIN_YANG_INK,
  type TypeInk,
} from "./nexamon-symbols";

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
  one_of_one: FULL,
  iron: CLASSIC,
  titanium: BREAKOUT,
  diamond: FULL,
  uranium: FULL,
};

/** The plate of a warrior card (ADR-182) where the component writes "KRIEGER", by layout. */
export const WARRIOR_LABEL: Record<FaceLayoutKind, Box> = {
  classic: { x: 7, y: 15, w: 23, h: 5 },
  breakout: { x: 4, y: 50, w: 23, h: 5 },
  full: { x: 5, y: 15, w: 23, h: 5 },
};

/** Yin (black) or Yang (white): the two legendaries of Yin Yang share a frame in opposite inks (ADR-182). */
export function yinYangSide(card: { set: string; rarity: string; number?: number }): "yin" | "yang" | null {
  if (card.set !== "yin_yang" || card.rarity !== "legendary") return null;
  return card.number === 110 ? "yang" : "yin";
}

const IRON_FRAME: TypeInk = {
  deep: IRON_INK.deep,
  dark: IRON_INK.dark,
  base: IRON_INK.base,
  light: IRON_INK.light,
  pale: IRON_INK.rivet,
  paper: IRON_INK.paper,
  paperShade: IRON_INK.paperShade,
};
const TITANIUM_FRAME: TypeInk = {
  deep: TITANIUM_INK.deep,
  dark: TITANIUM_INK.dark,
  base: TITANIUM_INK.base,
  light: TITANIUM_INK.light,
  pale: TITANIUM_INK.pale,
  paper: TITANIUM_INK.paper,
  paperShade: TITANIUM_INK.paperShade,
};

/** The inks of a framed card: the type's, or the metal of an iron or titanium card (ADR-182). */
export function frameInk(card: Pick<NexamonCard, "type" | "rarity">): TypeInk {
  if (card.rarity === "iron") return IRON_FRAME;
  if (card.rarity === "titanium") return TITANIUM_FRAME;
  return TYPE_INK[card.type];
}

/** The "ONE OF ONE" band across the middle of a One of One (ADR-174), and the serial "1/1" in it. */
export const ONE_OF_ONE_BAND: Box = { x: 0, y: 38, w: 72, h: 19 };

/** The plate in the head of an event card where the component writes "EREIGNIS" instead of the HP (ADR-174). */
export const EVENT_LABEL: Box = { x: 41, y: 4, w: 17, h: 6 };

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

type FaceCard = Pick<NexamonCard, "type" | "rarity" | "set" | "kind"> & { number?: number };

/** A sprinkle of stars over a box (event frames), always the same. */
function starDust(r: Raster, box: Box, hex: string, every: number): void {
  for (let y = box.y; y < box.y + box.h; y++)
    for (let x = box.x; x < box.x + box.w; x++) if ((x * 17 + y * 31 + x * y) % every === 0) setPixel(r, x, y, hex);
}

/** Iron (ADR-182): rust eats into the plate, rivets run down both sides, a few sparks fly off the corners. */
function drawIronWear(r: Raster): void {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const n = Math.sin(x * 0.7 + y * 0.31) + Math.sin(x * 0.23 - y * 0.9) + Math.sin((x + y) * 0.17);
      if (n > 1.5) setPixel(r, x, y, n > 2.1 ? IRON_INK.rustLight : IRON_INK.rust, bayer(x, y) < 0.6 ? 1 : 0.6);
    }
}

function drawIronRivets(r: Raster): void {
  for (let y = 16; y < 92; y += 8)
    for (const x of [1, W - 3]) {
      setPixel(r, x, y, IRON_INK.rivet);
      setPixel(r, x + 1, y, IRON_INK.light);
      setPixel(r, x, y + 1, IRON_INK.light);
      setPixel(r, x + 1, y + 1, IRON_INK.deep);
    }
  for (const [x, y] of [
    [4, 13],
    [3, 11],
    [67, 55],
    [69, 57],
    [66, 13],
  ] as const)
    setPixel(r, x, y, IRON_INK.spark);
}

function composeFramed(card: FaceCard, art: NexamonArt | undefined, layout: FaceLayout): Raster {
  const r = createRaster(W, H);
  const ink = frameInk(card);
  const iron = card.rarity === "iron";
  const ultra = card.rarity === "ultra" || card.rarity === "titanium";
  const event = card.kind === "event";

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
  } else if (event) {
    // Event cards: a night-sky frame, deep at the edges, with stardust in the type's light ink.
    ditherRect(r, 0, 0, W, H, [ink.dark, mixHex(ink.dark, ink.deep, 0.5), ink.deep, ink.deep]);
    starDust(r, { x: 0, y: 0, w: W, h: H }, ink.pale, 23);
  } else {
    ditherRect(r, 0, 0, W, H, [mixHex(ink.base, ink.light, 0.45), ink.base, ink.base, mixHex(ink.base, ink.dark, 0.6)]);
    if (iron) drawIronWear(r);
  }
  bevelRect(r, 1, 1, W - 2, H - 2, ultra ? "#ffffff" : event ? ink.light : ink.light, ink.dark);
  if (card.rarity === "titanium") strokeRect(r, 2, 2, W - 4, H - 4, TITANIUM_INK.blue, 0.7);

  // Name bar.
  const headTop = 2;
  const headHeight = ultra ? 8 : 10;
  ditherRect(r, 3, headTop, 66, headHeight, [mixHex(ink.paper, ink.light, 0.3), ink.paper, ink.paper]);
  fillRect(r, 3, headTop + headHeight - 1, 66, 1, ink.paperShade);

  // Art window: ink line, a bright line, then the picture.
  const win = CLASSIC.window;
  strokeRect(r, win.x - 2, win.y - 2, win.w + 4, win.h + 4, ink.deep);
  const plain = card.rarity === "common" || iron;
  const ring = iron ? IRON_INK.rustLight : plain ? ink.pale : GOLD_INK.light;
  bevelRect(
    r,
    win.x - 1,
    win.y - 1,
    win.w + 2,
    win.h + 2,
    ring,
    iron ? IRON_INK.rust : plain ? ink.light : GOLD_INK.base,
  );
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

  if (event) drawEventMarks(r, layout, ink.deep, ink.pale);
  if (card.kind === "warrior") drawWarriorPlate(r, WARRIOR_LABEL[layout.kind], ink.deep, ink.pale);
  if (iron) drawIronRivets(r);
  const symbol = TYPE_SYMBOL[card.type];
  blitGrid(r, symbol.grid, symbol.palette, layout.type.x, layout.type.y);
  blitGrid(r, symbol.grid, symbol.palette, layout.attackSymbol.x, layout.attackSymbol.y);
  drawFooterMarks(r, layout, card, ink.deep);

  roundCorners(r, 3);
  outlineEdge(r, ink.deep);
  return r;
}

/**
 * The marks of an event card: a dark plate for the "EREIGNIS" label where the HP would be (moved to the head of
 * the layout) and a dashed rule under the attack plate's name, so effect text reads as a rule, not a hit.
 */
function drawEventMarks(r: Raster, layout: FaceLayout, deep: string, pale: string): void {
  const label = { ...EVENT_LABEL, y: Math.round(layout.hp.y) };
  fillRect(r, label.x, label.y, label.w, label.h, deep);
  strokeRect(r, label.x, label.y, label.w, label.h, pale, 0.85);
  for (let x = layout.attackName.x; x < layout.attackName.x + layout.attackName.w + 14; x += 2)
    setPixel(r, x, Math.round(layout.attackName.y + layout.attackName.h), deep, 0.5);
}

/** The "KRIEGER" plate of a warrior card (ADR-182): dark with a light rim and a red seal dot. */
function drawWarriorPlate(r: Raster, box: Box, deep: string, pale: string): void {
  fillRect(r, box.x, box.y, box.w, box.h, deep, 0.9);
  strokeRect(r, box.x, box.y, box.w, box.h, pale, 0.8);
  fillRect(r, box.x + box.w - 3, box.y + 1, 2, box.h - 2, YIN_YANG_INK.seal);
}

/** Corner ornament of the legendary frame, drawn for the top left corner and mirrored for the others. */
const GOLD_CORNER = ["lllllll", "lbbbbd.", "lbldd..", "lbdl...", "lbd.l..", "ld.....", "l......"] as const;

/**
 * Diamond (ADR-182): full art in a crystal frame. The border is cut into facets in ice white and blue with a
 * prismatic pixel on every few, the plates are a clear deep blue, and four-point sparkles sit in the corners.
 */
function composeDiamond(card: FaceCard, art: NexamonArt | undefined, layout: FaceLayout): Raster {
  const r = createRaster(W, H);
  const d = DIAMOND_INK;
  drawArt(r, layout, card, art);
  for (const plate of FULL_PLATES) {
    fillRect(r, plate.x, plate.y, plate.w, plate.h, d.plate, 0.66);
    fillRect(r, plate.x, plate.y, plate.w, 1, d.light);
    fillRect(r, plate.x, plate.y + plate.h - 1, plate.w, 1, d.base, 0.6);
  }
  const facets = [d.pale, d.light, d.base, d.light, d.dark, d.light];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      if (edge > 3) continue;
      const cell = Math.floor((x + y) / 5) + Math.floor((x - y + 200) / 5);
      const hex = (x * 3 + y * 5) % 23 === 0 ? PRISM_INKS[cell % PRISM_INKS.length]! : facets[cell % facets.length]!;
      setPixel(r, x, y, edge === 0 ? d.deep : hex);
    }
  strokeRect(r, 4, 4, W - 8, H - 8, d.pale, 0.7);
  for (const [cx, cy] of [
    [6, 6],
    [W - 7, 6],
    [6, H - 7],
    [W - 7, H - 7],
  ] as const) {
    setPixel(r, cx, cy, "#ffffff");
    for (const k of [1, 2])
      for (const [dx, dy] of [
        [k, 0],
        [-k, 0],
        [0, k],
        [0, -k],
      ] as const)
        setPixel(r, cx + dx, cy + dy, k === 1 ? d.pale : d.light, k === 1 ? 1 : 0.7);
  }
  if (card.kind === "warrior") drawWarriorPlate(r, WARRIOR_LABEL.full, d.plate, d.light);
  const symbol = TYPE_SYMBOL[card.type];
  blitGrid(r, symbol.grid, symbol.palette, layout.type.x, layout.type.y);
  blitGrid(r, symbol.grid, symbol.palette, layout.attackSymbol.x, layout.attackSymbol.y);
  drawFooterMarks(r, layout, card, d.pale);
  roundCorners(r, 3);
  outlineEdge(r, d.deep);
  return r;
}

/**
 * Uranium (ADR-182): the artwork is a giant glowing eye, so the frame steps back. A thin black edge, then a
 * radioactive green glow that bleeds a few pixels into the picture; only the name and footer get a solid plate,
 * attack and flavour float on a light veil so the eye stays the centre.
 */
function composeUranium(card: FaceCard, art: NexamonArt | undefined, layout: FaceLayout): Raster {
  const r = createRaster(W, H);
  const u = URANIUM_INK;
  drawArt(r, layout, card, art);
  for (const [i, plate] of FULL_PLATES.entries()) {
    const solid = i === 0 || i === 3;
    fillRect(r, plate.x, plate.y, plate.w, plate.h, u.black, solid ? 0.78 : 0.42);
    fillRect(r, plate.x, plate.y, plate.w, 1, u.glow, solid ? 0.9 : 0.5);
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      if (edge < 2) setPixel(r, x, y, u.black);
      else if (edge === 2) setPixel(r, x, y, u.pale);
      else if (edge === 3) setPixel(r, x, y, u.glow);
      else if (edge < 8 && bayer(x, y) < (8 - edge) / 6) setPixel(r, x, y, u.base, 0.55 - (edge - 4) * 0.1);
    }
  // hazard marks in the corners: a black square with a glowing dot
  for (const [cx, cy] of [
    [4, 4],
    [W - 7, 4],
    [4, H - 7],
    [W - 7, H - 7],
  ] as const) {
    fillRect(r, cx, cy, 3, 3, u.black);
    setPixel(r, cx + 1, cy + 1, u.glow);
  }
  const symbol = TYPE_SYMBOL[card.type];
  blitGrid(r, symbol.grid, symbol.palette, layout.type.x, layout.type.y);
  blitGrid(r, symbol.grid, symbol.palette, layout.attackSymbol.x, layout.attackSymbol.y);
  drawFooterMarks(r, layout, card, u.glow);
  roundCorners(r, 3);
  outlineEdge(r, u.black);
  return r;
}

/**
 * Yin and Yang (ADR-182): the two legendaries of Yin Yang wear the legendary frame in ink instead of gold. Yin is
 * black with silver lines and white corner dots, Yang its negative: white with grey lines and black dots. Side by
 * side the corners mirror each other; both carry the red seal of the pack in the upper right.
 */
function composeYinYang(card: FaceCard, art: NexamonArt | undefined, layout: FaceLayout, side: "yin" | "yang"): Raster {
  const r = createRaster(W, H);
  const y = YIN_YANG_INK;
  const yin = side === "yin";
  const main = yin ? y.black : y.paper;
  const line = yin ? y.silver : y.grey;
  const dot = yin ? y.white : y.black;
  drawArt(r, layout, card, art);
  for (const plate of FULL_PLATES) {
    fillRect(r, plate.x, plate.y, plate.w, plate.h, main, 0.8);
    strokeRect(r, plate.x, plate.y, plate.w, plate.h, line);
    for (const [cx, cy] of [
      [plate.x, plate.y],
      [plate.x + plate.w - 1, plate.y],
      [plate.x, plate.y + plate.h - 1],
      [plate.x + plate.w - 1, plate.y + plate.h - 1],
    ] as const)
      setPixel(r, cx, cy, dot);
  }
  strokeRect(r, 0, 0, W, H, y.black);
  for (let i = 1; i <= 2; i++) strokeRect(r, i, i, W - 2 * i, H - 2 * i, main);
  strokeRect(r, 3, 3, W - 6, H - 6, line, 0.9);
  // a yin-yang dot pair in every corner: the own colour's dot holds the other colour's eye
  for (const [cx, cy] of [
    [4, 4],
    [W - 8, 4],
    [4, H - 8],
    [W - 8, H - 8],
  ] as const) {
    fillRect(r, cx + 1, cy, 2, 4, dot);
    fillRect(r, cx, cy + 1, 4, 2, dot);
    setPixel(r, cx + 1, cy + 1, main);
  }
  fillRect(r, W - 13, 1, 4, 3, y.seal);
  setPixel(r, W - 12, 2, y.paper);
  if (card.kind === "warrior") drawWarriorPlate(r, WARRIOR_LABEL.full, main, line);
  const symbol = TYPE_SYMBOL[card.type];
  blitGrid(r, symbol.grid, symbol.palette, layout.type.x, layout.type.y);
  blitGrid(r, symbol.grid, symbol.palette, layout.attackSymbol.x, layout.attackSymbol.y);
  drawFooterMarks(r, layout, card, yin ? y.silver : y.black);
  roundCorners(r, 3);
  outlineEdge(r, y.black);
  return r;
}

function composeFull(card: FaceCard, art: NexamonArt | undefined, layout: FaceLayout): Raster {
  const r = createRaster(W, H);
  const ink = TYPE_INK[card.type];
  if (card.rarity === "one_of_one") return composeOneOfOne(card, art, layout);
  if (card.rarity === "diamond") return composeDiamond(card, art, layout);
  if (card.rarity === "uranium") return composeUranium(card, art, layout);
  const side = yinYangSide(card);
  if (side) return composeYinYang(card, art, layout, side);
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

  if (card.kind === "warrior") drawWarriorPlate(r, WARRIOR_LABEL.full, gold ? GOLD_INK.plate : ink.deep, "#ffffff");
  const symbol = TYPE_SYMBOL[card.type];
  blitGrid(r, symbol.grid, symbol.palette, layout.type.x, layout.type.y);
  blitGrid(r, symbol.grid, symbol.palette, layout.attackSymbol.x, layout.attackSymbol.y);
  drawFooterMarks(r, layout, card, gold ? GOLD_INK.light : "#ffffff");

  roundCorners(r, 3);
  outlineEdge(r, gold ? GOLD_INK.deep : ink.deep);
  return r;
}

/**
 * The One of One frame (ADR-174): full art inside a black-and-gold double frame whose inner line shimmers in an
 * iridescent run (teal, blue, violet, magenta, rose), black plates with gold rules and, across the middle, a
 * black band with gold edges and the words ONE OF ONE in big gold pixel letters, the serial 1/1 beneath.
 */
function composeOneOfOne(card: FaceCard, art: NexamonArt | undefined, layout: FaceLayout): Raster {
  const r = createRaster(W, H);
  const o = ONE_OF_ONE_INK;
  drawArt(r, layout, card, art);

  for (const plate of FULL_PLATES) {
    fillRect(r, plate.x, plate.y, plate.w, plate.h, o.black, 0.8);
    fillRect(r, plate.x, plate.y, plate.w, 1, o.gold);
    fillRect(r, plate.x, plate.y + plate.h - 1, plate.w, 1, o.goldDeep);
  }
  if (card.kind === "event") drawEventMarks(r, layout, o.black, o.gold);

  // The band: black with a gold edge, an iridescent hairline inside, the words in gold with a deep shadow.
  const band = ONE_OF_ONE_BAND;
  fillRect(r, band.x, band.y, band.w, band.h, o.black, 0.9);
  fillRect(r, band.x, band.y, band.w, 1, o.goldLight);
  fillRect(r, band.x, band.y + 1, band.w, 1, o.goldDeep);
  fillRect(r, band.x, band.y + band.h - 1, band.w, 1, o.goldLight);
  fillRect(r, band.x, band.y + band.h - 2, band.w, 1, o.goldDeep);
  for (let x = 0; x < W; x++) {
    setPixel(r, x, band.y + 2, o.iris[Math.floor(x / 5) % o.iris.length]!, 0.8);
    setPixel(r, x, band.y + band.h - 3, o.iris[(Math.floor(x / 5) + 2) % o.iris.length]!, 0.8);
  }
  // Letters at twice the size with a one-pixel gap, so the words fill the band: 64 of 72 pixels.
  const text = "ONE OF ONE";
  const advance = (ch: string) => (ch === " " ? 4 : microTextWidth(ch, 2) + 1);
  const width = [...text].reduce((w, ch) => w + advance(ch), -1);
  const ty = band.y + 4;
  const word = (x0: number, y0: number, hex: string) => {
    let x = x0;
    for (const ch of text) {
      if (ch !== " ") drawMicroText(r, ch, x, y0, hex, 2);
      x += advance(ch);
    }
  };
  const tx = Math.round((W - width) / 2);
  word(tx + 1, ty + 1, o.goldDeep);
  word(tx, ty, o.gold);
  // highlight the top row of every letter
  for (let x = 0; x < W; x++) if (pixelIs(r, x, ty, o.gold)) setPixel(r, x, ty, o.goldLight);
  drawMicroTextCentered(r, "1/1", W / 2, ty + 11, o.white, 1);

  // Double frame: black, gold with a bevel, then the iridescent run, then black again.
  strokeRect(r, 0, 0, W, H, o.black);
  bevelRect(r, 1, 1, W - 2, H - 2, o.goldLight, o.goldDeep);
  const perimeter: [number, number][] = [];
  for (let x = 2; x < W - 2; x++) perimeter.push([x, 2]);
  for (let y = 3; y < H - 2; y++) perimeter.push([W - 3, y]);
  for (let x = W - 4; x >= 2; x--) perimeter.push([x, H - 3]);
  for (let y = H - 4; y >= 3; y--) perimeter.push([2, y]);
  perimeter.forEach(([x, y], i) => setPixel(r, x, y, o.iris[Math.floor(i / 6) % o.iris.length]!));
  strokeRect(r, 3, 3, W - 6, H - 6, o.black, 0.9);
  // gold diamonds in the corners
  for (const [cx, cy] of [
    [5, 5],
    [W - 6, 5],
    [5, H - 6],
    [W - 6, H - 6],
  ] as const) {
    setPixel(r, cx, cy, o.goldLight);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      setPixel(r, cx + dx, cy + dy, o.gold);
  }

  const symbol = TYPE_SYMBOL[card.type];
  blitGrid(r, symbol.grid, symbol.palette, layout.type.x, layout.type.y);
  blitGrid(r, symbol.grid, symbol.palette, layout.attackSymbol.x, layout.attackSymbol.y);
  drawFooterMarks(r, layout, card, o.goldLight);

  roundCorners(r, 3);
  outlineEdge(r, o.black);
  return r;
}

function pixelIs(r: Raster, x: number, y: number, hex: string): boolean {
  const i = (y * r.width + x) * 4;
  const v = parseInt(hex.slice(1), 16);
  return (
    r.data[i + 3]! > 0 && r.data[i]! === v >> 16 && r.data[i + 1]! === ((v >> 8) & 255) && r.data[i + 2]! === (v & 255)
  );
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
