import type { NexamonSetKey } from "@/config/nexamon/types";
import { drawMicroText, drawMicroTextCentered, microTextWidth } from "./nexamon-font";
import {
  bayer,
  clearPixel,
  createRaster,
  ditherRect,
  fillRect,
  isOpaque,
  roundCorners,
  setPixel,
  strokeRect,
  type Raster,
} from "./nexamon-raster";
import { GOLD_INK, ONE_OF_ONE_INK, PRISM_INKS, SET_INK } from "./nexamon-symbols";

/*
 * Booster packs and the grading slab as pixel art (ADR-165). A pack is drawn once and then split along a jagged
 * line into the strip that is torn off and the rest, so the opening can move the two pieces apart.
 */

export const PACK_SIZE = { width: 76, height: 112 } as const;
const PW = PACK_SIZE.width;
const PH = PACK_SIZE.height;
const CRIMP = 8;

/** Names on the pack fronts (the sets keep their English names in every language). */
export const SET_TITLE: Record<NexamonSetKey, string> = {
  mystic_energy: "MYSTIC ENERGY",
  super_apex: "SUPER APEX",
  prismatic_peak: "PRISMATIC PEAK",
  cosmic_winds: "COSMIC WINDS",
  titans_revenge: "TITANS REVENGE",
  yin_yang: "YIN YANG",
};

function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function star(r: Raster, x: number, y: number, hex: string, big: boolean): void {
  setPixel(r, x, y, big ? "#ffffff" : hex);
  if (big)
    for (const [ox, oy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      setPixel(r, x + ox, y + oy, hex, 0.8);
}

function drawMystic(r: Raster): void {
  const ink = SET_INK.mystic_energy;
  ditherRect(r, 0, 0, PW, PH, [ink.deep, ink.dark, ink.base, ink.dark, ink.deep]);
  const cx = 37.5;
  const cy = 60;
  // A vortex of teal energy: two arms winding into a white core.
  for (let y = 26; y < 94; y++)
    for (let x = 2; x < PW - 2; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > 31) continue;
      const arm = Math.sin(Math.atan2(dy, dx) * 2 - d * 0.42);
      const power = (1 - d / 31) * 0.75 + arm * 0.32;
      const t = bayer(x, y) * 0.16;
      if (d < 4.5 || power > 0.86) setPixel(r, x, y, "#ffffff");
      else if (power > 0.62 + t) setPixel(r, x, y, ink.pale);
      else if (power > 0.42 + t) setPixel(r, x, y, ink.light);
      else if (power > 0.26 + t) setPixel(r, x, y, "#1f8fa8");
    }
  const rand = rng(3);
  for (let i = 0; i < 34; i++) {
    const x = 3 + Math.floor(rand() * (PW - 6));
    const y = 28 + Math.floor(rand() * 60);
    if (Math.hypot(x - cx, y - cy) > 24) star(r, x, y, "#c9b8ff", rand() > 0.75);
  }
}

function drawApex(r: Raster): void {
  const ink = SET_INK.super_apex;
  ditherRect(r, 0, 0, PW, PH, [ink.deep, ink.dark, ink.base, ink.base, ink.dark]);
  const cx = 37.5;
  const cy = 62;
  // A sunburst behind the emblem.
  for (let y = 24; y < 96; y++)
    for (let x = 1; x < PW - 1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const ray = Math.sin(Math.atan2(y - cy, x - cx) * 9);
      if (ray > 0.2 && bayer(x, y) > d / 60) setPixel(r, x, y, d < 13 ? ink.pale : ink.light);
    }
  // Two chevrons pointing up, with a shadow and a light edge.
  const chevron = (top: number, hex: string, ox: number, oy: number) => {
    for (let i = 0; i < 22; i++)
      for (let t = 0; t < 9; t++) {
        setPixel(r, Math.round(cx - 0.5) - i + ox, top + i + t + oy, hex);
        setPixel(r, Math.round(cx + 0.5) + i + ox, top + i + t + oy, hex);
      }
  };
  for (const top of [38, 54]) {
    chevron(top, ink.deep, 2, 2);
    chevron(top, ink.deep, -1, 0);
    chevron(top, ink.deep, 1, 0);
    chevron(top, ink.deep, 0, -1);
    chevron(top, ink.pale, 0, 0);
    for (let i = 0; i < 22; i++)
      for (let t = 5; t < 9; t++) {
        setPixel(r, Math.round(cx - 0.5) - i, top + i + t, ink.light);
        setPixel(r, Math.round(cx + 0.5) + i, top + i + t, ink.light);
      }
  }
}

function drawPeak(r: Raster): void {
  const ink = SET_INK.prismatic_peak;
  ditherRect(r, 0, 0, PW, PH, [ink.deep, ink.deep, ink.dark, "#3a2f9c", "#7a3fae"]);
  const rand = rng(9);
  for (let i = 0; i < 40; i++)
    star(r, 3 + Math.floor(rand() * (PW - 6)), 26 + Math.floor(rand() * 40), "#bcd0ff", rand() > 0.8);
  // Rainbow light fans out from the summit.
  const top = { x: 38, y: 40 };
  for (let y = 24; y < 80; y++)
    for (let x = 0; x < PW; x++) {
      const angle = Math.atan2(top.y - y, x - top.x);
      const d = Math.hypot(x - top.x, y - top.y);
      if (angle < 0.25 || angle > 2.9 || d < 3) continue;
      const band = Math.floor(((angle - 0.25) / 2.65) * PRISM_INKS.length);
      if (bayer(x, y) > d / 70) setPixel(r, x, y, PRISM_INKS[PRISM_INKS.length - 1 - band]!, 0.9);
    }
  // The peak: a lit left face, a shaded right face, snow on top; lower ridges in front.
  const peak = (px: number, py: number, half: number, base: number, lit: string, shade: string, snow: number) => {
    for (let y = py; y < base; y++) {
      const reach = ((y - py) / (base - py)) * half;
      for (let x = Math.round(px - reach); x <= Math.round(px + reach); x++) {
        const ridge = px + Math.sin((y - py) * 0.5) * 1.5;
        const snowy = y - py < snow + Math.sin(x * 1.3) * 1.5;
        setPixel(r, x, y, x < ridge ? (snowy ? "#ffffff" : lit) : snowy ? ink.light : shade);
      }
    }
  };
  peak(38, 40, 34, 100, ink.base, ink.dark, 13);
  peak(12, 68, 22, 100, "#3f6fc0", "#1c2f6e", 5);
  peak(64, 72, 20, 100, "#3f6fc0", "#1c2f6e", 4);
  // The prism at the summit.
  for (let i = 0; i < 5; i++) fillRect(r, top.x - i, top.y - 6 + i, i * 2 + 1, 1, i < 2 ? "#ffffff" : ink.light);
  fillRect(r, top.x - 4, top.y - 1, 9, 1, ink.deep);
}

/**
 * Cosmic Winds (ADR-174): a deep-space foil. A pink and blue nebula drifts across the black, a ringed planet hangs
 * in the middle with its ring in front, solar wind streams past in long dashes and a comet cuts the upper corner.
 */
function drawCosmic(r: Raster): void {
  const ink = SET_INK.cosmic_winds;
  ditherRect(r, 0, 0, PW, PH, [ink.deep, ink.deep, "#0a0824", ink.dark, "#0a0824"]);
  // Nebula: two soft clouds, pink to the left, blue to the right, dithered so they stay pixel art.
  for (let y = 22; y < 100; y++)
    for (let x = 0; x < PW; x++) {
      const pink = 1 - Math.hypot((x - 18) / 26, (y - 70) / 20);
      const blue = 1 - Math.hypot((x - 58) / 24, (y - 44) / 22);
      const t = bayer(x, y);
      if (pink > t * 0.9 + 0.05) setPixel(r, x, y, pink > 0.6 ? "#ff8ad8" : "#7a2f8f", pink > 0.6 ? 0.55 : 0.6);
      if (blue > t * 0.9 + 0.05) setPixel(r, x, y, blue > 0.6 ? "#7fd4ff" : "#22408f", blue > 0.6 ? 0.5 : 0.6);
    }
  const rand = rng(41);
  for (let i = 0; i < 60; i++)
    star(r, 2 + Math.floor(rand() * (PW - 4)), 22 + Math.floor(rand() * 74), "#d8d0ff", rand() > 0.85);
  // Solar wind: long dashes that sweep down to the right.
  for (let i = 0; i < 9; i++) {
    const y0 = 30 + i * 8;
    for (let k = 0; k < 26; k++) {
      const x = ((i * 23 + k) % (PW + 20)) - 10;
      if (k % 9 > 5) continue;
      setPixel(r, x, y0 + Math.floor(k / 6), ink.pale, 0.55 - k * 0.015);
    }
  }
  // The planet: a shaded sphere with bands, light from the upper left.
  const cx = 38;
  const cy = 60;
  const radius = 17;
  for (let y = -radius; y <= radius; y++)
    for (let x = -radius; x <= radius; x++) {
      const d = Math.hypot(x, y);
      if (d > radius) continue;
      const light = (-x - y) / (radius * 1.6) + 0.5 - d / (radius * 3);
      const band = Math.sin((y + x * 0.2) * 0.7) > 0.4;
      const stops = ["#140d3d", ink.dark, ink.base, "#8f7cff", "#d9d2ff"];
      const idx = Math.max(0, Math.min(4, Math.floor((light + bayer(cx + x, cy + y) * 0.25) * 4)));
      setPixel(r, cx + x, cy + y, band && idx > 0 ? stops[idx - 1]! : stops[idx]!);
    }
  // The ring: an ellipse, behind the planet at the top, in front at the bottom, in the iridescent One of One inks.
  for (let a = 0; a < 360; a += 1) {
    const rad = (a * Math.PI) / 180;
    const x = Math.round(cx + Math.cos(rad) * 31);
    const y = Math.round(cy + Math.sin(rad) * 7 - Math.cos(rad) * 4);
    const behind = Math.sin(rad) < 0 && Math.hypot(x - cx, y - cy) < radius;
    if (behind) continue;
    const hex = ONE_OF_ONE_INK.iris[Math.floor(a / 24) % ONE_OF_ONE_INK.iris.length]!;
    setPixel(r, x, y, hex);
    setPixel(r, x, y + 1, hex, 0.5);
  }
  // A comet in the upper right corner, its tail streaming back.
  for (let k = 0; k < 18; k++) setPixel(r, 66 - k, 27 + Math.floor(k / 2), k < 3 ? "#ffffff" : "#bfe9ff", 1 - k / 20);
  fillRect(r, 65, 26, 2, 2, "#ffffff");
}

/**
 * Titans Revenge (ADR-182): a slab of dark riveted armour plate. A titan's head and shoulders rise from the bottom
 * as a black silhouette against a furnace glow, one huge ember eye burning in its face; molten cracks run through
 * the plates and sparks drift up.
 */
function drawTitans(r: Raster): void {
  const ink = SET_INK.titans_revenge;
  ditherRect(r, 0, 0, PW, PH, [ink.dark, ink.base, ink.dark, ink.deep]);
  // Armour plates: horizontal seams with a light lip, rivets along every seam and down both sides.
  for (const y of [30, 52, 74, 96]) {
    fillRect(r, 0, y, PW, 1, ink.deep);
    fillRect(r, 0, y + 1, PW, 1, "#6a7079", 0.6);
    for (let x = 4; x < PW - 2; x += 9) {
      setPixel(r, x, y - 2, "#9aa1aa");
      setPixel(r, x + 1, y - 2, "#5c626b");
      setPixel(r, x, y - 1, "#5c626b");
      setPixel(r, x + 1, y - 1, ink.deep);
    }
  }
  // Furnace glow behind the titan, strongest low in the middle.
  for (let y = 40; y < PH - CRIMP; y++)
    for (let x = 0; x < PW; x++) {
      const g = 1 - Math.hypot((x - 38) / 40, (y - 104) / 46);
      if (g > bayer(x, y) * 0.9) setPixel(r, x, y, g > 0.55 ? "#ff8a2a" : g > 0.3 ? "#c2410c" : "#5a1a08", 0.75);
    }
  // The silhouette: a heavy head on a neck between massive shoulders.
  const cx = 38;
  for (let y = 44; y < PH - CRIMP; y++)
    for (let x = 0; x < PW; x++) {
      const head = Math.hypot((x - cx) / 13, (y - 60) / 15) < 1 && y > 46;
      const jaw = y >= 60 && y < 78 && Math.abs(x - cx) < 12 - (y - 60) * 0.25;
      const shoulders = y > 76 && Math.abs(x - cx) < 18 + (y - 76) * 2.2;
      const horns = y > 40 && y < 54 && Math.abs(Math.abs(x - cx) - (14 - (y - 40) * 0.25)) < 1.6 - (54 - y) * 0.08;
      if (head || jaw || shoulders || horns) setPixel(r, x, y, "#050506");
    }
  // Rim light on the shoulders.
  for (let x = 0; x < PW; x++)
    for (let y = 76; y < PH - CRIMP; y++) {
      if (Math.abs(Math.abs(x - cx) - (18 + (y - 76) * 2.2)) < 0.8) setPixel(r, x, y, "#ff8a2a", 0.8);
    }
  // The eye: a burning ember with a slit pupil and a halo.
  const ey = 60;
  for (let y = -9; y <= 9; y++)
    for (let x = -12; x <= 12; x++) {
      const d = Math.hypot(x / 10, y / 4.2);
      const halo = Math.hypot(x / 13, y / 8);
      if (d < 1) {
        const hex = d < 0.35 ? "#fff3c4" : d < 0.65 ? "#ffb347" : "#ff5a1f";
        setPixel(r, cx + x, ey + y, Math.abs(x) < 1 && Math.abs(y) < 4 ? "#050506" : hex);
      } else if (halo < 1 && bayer(cx + x, ey + y) < 1 - halo) setPixel(r, cx + x, ey + y, "#ff5a1f", 0.5);
    }
  // Molten cracks and sparks.
  const rand = rng(77);
  for (const [x0, y0, dir] of [
    [6, 34, 1],
    [70, 56, -1],
    [10, 78, 1],
  ] as const) {
    let x = x0;
    for (let y = y0; y < y0 + 14; y++) {
      x += rand() > 0.5 ? dir : 0;
      setPixel(r, x, y, "#ffb347");
      setPixel(r, x + 1, y, "#c2410c", 0.6);
    }
  }
  for (let i = 0; i < 26; i++) {
    const x = 3 + Math.floor(rand() * (PW - 6));
    const y = 28 + Math.floor(rand() * 40);
    setPixel(r, x, y, rand() > 0.6 ? "#ffd27a" : "#ff8a2a", 0.9);
  }
}

/**
 * Yin Yang (ADR-182): black and white ink on rice paper. Grey washes of mountains in the back, one big ensō drawn
 * in a single brush stroke with a yin-yang inside, and a red seal stamp as the only colour on the pack.
 */
function drawYinYang(r: Raster): void {
  const ink = SET_INK.yin_yang;
  ditherRect(r, 0, 0, PW, PH, [ink.pale, ink.pale, "#e9e5dc", ink.pale]);
  // Paper fibres.
  for (let y = 0; y < PH; y++)
    for (let x = 0; x < PW; x++) if ((x * 13 + y * 7 + x * y) % 37 === 0) setPixel(r, x, y, "#d8d3c8");
  // Ink-wash mountains: two ridges in pale and mid grey, fading into the paper.
  for (let x = 0; x < PW; x++) {
    const far = 74 + Math.sin(x * 0.11) * 8 + Math.sin(x * 0.31) * 3;
    const near = 88 + Math.sin(x * 0.07 + 2) * 7 + Math.sin(x * 0.23) * 2;
    for (let y = Math.round(far); y < PH - CRIMP; y++)
      if (bayer(x, y) < 0.75 - (y - far) / 40) setPixel(r, x, y, "#a9a59d");
    for (let y = Math.round(near); y < PH - CRIMP; y++)
      setPixel(r, x, y, bayer(x, y) < 0.6 + (y - near) / 30 ? "#4a4a4a" : "#8a8a8a");
  }
  // The ensō: a ring of uneven width, opening at the upper right, dry brush at its tail.
  const cx = 38;
  const cy = 56;
  for (let y = 22; y < 92; y++)
    for (let x = 0; x < PW; x++) {
      const a = Math.atan2(y - cy, x - cx);
      const t = ((a + Math.PI * 0.32 + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
      if (t > 0.94) continue;
      const width = 2.2 + 3.2 * Math.sin(t * Math.PI) + Math.sin(t * 40) * 0.4;
      const d = Math.hypot(x - cx, y - cy);
      if (Math.abs(d - 28) < width / 2) {
        if (t > 0.8 && bayer(x, y) < (t - 0.8) * 5) continue;
        setPixel(r, x, y, "#0a0a0a");
      }
    }
  // Yin-yang inside the ring.
  const R = 15;
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++) {
      const d = Math.hypot(x, y);
      if (d > R + 0.3) continue;
      let dark = x > 0;
      if (Math.hypot(x, y + R / 2) < R / 2) dark = true;
      if (Math.hypot(x, y - R / 2) < R / 2) dark = false;
      if (Math.hypot(x, y + R / 2) < 2.2) dark = false;
      if (Math.hypot(x, y - R / 2) < 2.2) dark = true;
      setPixel(r, cx + x, cy + y, d > R - 0.8 ? "#0a0a0a" : dark ? "#0a0a0a" : "#fbfaf6");
    }
  // The seal: a red square stamp with a white mark, slightly uneven like a real stamp.
  const sx = 56;
  const sy = 80;
  fillRect(r, sx, sy, 12, 12, ink.light);
  for (let i = 0; i < 12; i++) if (i % 5 === 2) setPixel(r, sx + i, sy, ink.pale);
  strokeRect(r, sx + 2, sy + 2, 8, 8, ink.pale);
  fillRect(r, sx + 4, sy + 4, 1, 4, ink.pale);
  fillRect(r, sx + 4, sy + 4, 4, 1, ink.pale);
  fillRect(r, sx + 7, sy + 4, 1, 4, ink.pale);
  fillRect(r, sx + 5, sy + 6, 2, 1, ink.pale);
  // Ink splatter.
  const rand = rng(108);
  for (let i = 0; i < 14; i++)
    setPixel(r, 3 + Math.floor(rand() * (PW - 6)), 24 + Math.floor(rand() * 20), "#1a1a1a", 0.8);
}

export interface PackRasters {
  /** The sealed pack. */
  full: Raster;
  /** The strip that tears off, on a canvas of the full pack size. */
  top: Raster;
  /** The pack without the strip. */
  body: Raster;
}

const packCache = new Map<NexamonSetKey, PackRasters>();

/** Row of the tear in column x: a jagged line just under the upper crimp. */
export const packTearRow = (x: number): number => CRIMP + 2 + [0, 1, 2, 1, 0, 1, 3, 2, 1, 2, 0, 1][x % 12]!;

/** The booster pack of a set: sealed, and split into the torn strip and the rest. */
export function composePack(set: NexamonSetKey): PackRasters {
  const hit = packCache.get(set);
  if (hit) return hit;
  const ink = SET_INK[set];
  const full = createRaster(PW, PH);
  if (set === "mystic_energy") drawMystic(full);
  else if (set === "super_apex") drawApex(full);
  else if (set === "cosmic_winds") drawCosmic(full);
  else if (set === "titans_revenge") drawTitans(full);
  else if (set === "yin_yang") drawYinYang(full);
  else drawPeak(full);

  // Title band and set name.
  fillRect(full, 0, CRIMP + 3, PW, 16, ink.deep, 0.6);
  fillRect(full, 0, CRIMP + 3, PW, 1, ink.pale, 0.7);
  fillRect(full, 0, CRIMP + 18, PW, 1, ink.pale, 0.7);
  drawMicroTextCentered(full, "NEXAMON", PW / 2 + 1, CRIMP + 7, ink.deep, 2);
  drawMicroTextCentered(
    full,
    "NEXAMON",
    PW / 2,
    CRIMP + 6,
    set === "prismatic_peak" || set === "cosmic_winds" || set === "yin_yang"
      ? "#ffffff"
      : set === "titans_revenge"
        ? "#ffb347"
        : "#ffe25c",
    2,
  );
  fillRect(full, 0, PH - CRIMP - 13, PW, 9, ink.deep, 0.7);
  fillRect(full, 0, PH - CRIMP - 13, PW, 1, ink.pale, 0.6);
  const title = SET_TITLE[set];
  if (set === "prismatic_peak") {
    // Every letter in its own rainbow ink.
    let x = Math.round(PW / 2 - microTextWidth(title) / 2);
    [...title].forEach((ch, i) => {
      x = drawMicroText(full, ch, x, PH - CRIMP - 11, PRISM_INKS[i % PRISM_INKS.length]!) + 0;
    });
  } else if (set === "cosmic_winds") {
    // The iridescent run of the One of Ones, letter by letter.
    let x = Math.round(PW / 2 - microTextWidth(title) / 2);
    [...title].forEach((ch, i) => {
      x = drawMicroText(full, ch, x, PH - CRIMP - 11, ONE_OF_ONE_INK.iris[i % ONE_OF_ONE_INK.iris.length]!);
    });
  } else if (set === "titans_revenge") drawMicroTextCentered(full, title, PW / 2, PH - CRIMP - 11, ink.light);
  else drawMicroTextCentered(full, title, PW / 2, PH - CRIMP - 11, ink.pale);

  // Crimped seals: ridges of foil, a shadow line where the body begins, teeth on the outer edge.
  for (const y0 of [0, PH - CRIMP]) {
    for (let y = y0; y < y0 + CRIMP; y++)
      for (let x = 0; x < PW; x++) setPixel(full, x, y, x % 3 === 0 ? ink.dark : x % 3 === 1 ? ink.base : ink.light);
    fillRect(full, 0, y0 === 0 ? CRIMP - 1 : y0, PW, 1, ink.deep, 0.75);
    fillRect(full, 0, y0 === 0 ? CRIMP : y0 - 1, PW, 1, "#ffffff", 0.35);
  }
  for (let x = 0; x < PW; x++)
    if (x % 4 < 2) {
      clearPixel(full, x, 0);
      clearPixel(full, x, PH - 1);
    }
  // Foil edges left and right.
  fillRect(full, 0, 1, 1, PH - 2, ink.deep, 0.8);
  fillRect(full, PW - 1, 1, 1, PH - 2, ink.deep, 0.8);
  fillRect(full, 1, CRIMP, 1, PH - 2 * CRIMP, "#ffffff", 0.3);

  const top = createRaster(PW, PH);
  const body = createRaster(PW, PH);
  for (let x = 0; x < PW; x++) {
    const tear = packTearRow(x);
    for (let y = 0; y < PH; y++) {
      const i = (y * PW + x) * 4;
      (y < tear ? top : body).data.set(full.data.subarray(i, i + 4), i);
    }
    // The torn edges show the white inside of the foil.
    if (isOpaque(top, x, tear - 1)) setPixel(top, x, tear - 1, "#ffffff", 0.85);
    setPixel(body, x, tear, "#ffffff", 0.85);
  }
  const out = { full, top, body };
  packCache.set(set, out);
  return out;
}

// ------------------------------------------------------------------ grading slab

/** Sizes of the slab in art pixels: the case, the label on top and where the card sits. */
export const SLAB_SIZE = { width: 86, height: 138 } as const;
export const SLAB_LABEL = { x: 5, y: 5, w: 76, h: 23 } as const;
export const SLAB_CARD = { x: 7, y: 33 } as const;

/** Inks of the made-up grading company "ASP". */
export const ASP_INK = {
  brand: "#0f6b63",
  brandDark: "#083f3b",
  brandLight: "#3fc7b4",
  paper: "#fbfaf2",
  paperShade: "#e6e3d2",
  ink: "#16211f",
} as const;

/** Inks of the Black Label: a black label with silver print. */
export const BLACK_LABEL_INK = {
  black: "#0b0c10",
  shade: "#191b22",
  silver: "#c9ced8",
  silverDark: "#7d8492",
  white: "#ffffff",
} as const;

/** Label of a slab: plain for 1 to 9, gold for a 10, black for the Black Label (grade 11). */
export type SlabTier = "plain" | "gold" | "black";
export const slabTier = (grade: number): SlabTier => (grade >= 11 ? "black" : grade >= 10 ? "gold" : "plain");

/** The ASP emblem: a hexagonal seal with the three letters, 17 x 15. */
function drawAspEmblem(r: Raster, x: number, y: number, tier: SlabTier): void {
  const fill = tier === "black" ? BLACK_LABEL_INK.silver : tier === "gold" ? GOLD_INK.base : ASP_INK.brand;
  const edge = tier === "black" ? BLACK_LABEL_INK.silverDark : tier === "gold" ? GOLD_INK.deep : ASP_INK.brandDark;
  const light = tier === "black" ? BLACK_LABEL_INK.white : tier === "gold" ? GOLD_INK.pale : ASP_INK.brandLight;
  for (let py = 0; py < 15; py++) {
    const inset = Math.max(0, Math.abs(py - 7) - 3);
    for (let px = inset; px < 17 - inset; px++)
      setPixel(r, x + px, y + py, px === inset || px === 16 - inset || py === 0 || py === 14 ? edge : fill);
  }
  fillRect(r, x + 5, y + 1, 7, 1, light);
  drawMicroText(
    r,
    "ASP",
    x + 3,
    y + 5,
    tier === "black" ? BLACK_LABEL_INK.black : tier === "gold" ? GOLD_INK.deep : "#ffffff",
  );
}

const slabCache = new Map<string, { front: Raster; back: Raster }>();

/**
 * The plastic case of a graded card, front and back. A grade of 10 gets the gold label, the Black Label (11) a
 * black one with silver print.
 */
export function composeSlab(grade: number, oneOfOne = false): { front: Raster; back: Raster } {
  const tier = slabTier(grade);
  const gold = tier === "gold";
  const black = tier === "black";
  const cacheKey = oneOfOne ? `${tier}:1of1` : tier;
  const hit = slabCache.get(cacheKey);
  if (hit) return hit;
  const { width: w, height: h } = SLAB_SIZE;
  const build = (back: boolean): Raster => {
    const r = createRaster(w, h);
    // Clear plastic: a faint blue body, a bright rim and two streaks of light.
    fillRect(r, 0, 0, w, h, "#d6e8ff", 0.2);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const streak = (x + y * 0.55) % 64;
        if ((streak < 7 || (streak > 12 && streak < 15)) && bayer(x, y) > 0.45) setPixel(r, x, y, "#ffffff", 0.3);
      }
    strokeRect(r, 0, 0, w, h, "#9fb4cc", 0.95);
    fillRect(r, 1, 1, w - 2, 1, "#ffffff", 0.85);
    fillRect(r, 1, 2, 1, h - 3, "#ffffff", 0.7);
    fillRect(r, 2, h - 2, w - 3, 1, "#5f7690", 0.55);
    fillRect(r, w - 2, 2, 1, h - 4, "#5f7690", 0.45);
    // The well the card lies in, and the weld line around everything.
    strokeRect(r, 3, 3, w - 6, h - 6, "#7f95ad", 0.5);
    fillRect(r, SLAB_CARD.x - 2, SLAB_CARD.y - 2, 76, 104, "#0b1220", 0.22);
    strokeRect(r, SLAB_CARD.x - 2, SLAB_CARD.y - 2, 76, 104, "#6f859d", 0.7);
    fillRect(r, SLAB_CARD.x - 1, SLAB_CARD.y + 102, 74, 1, "#ffffff", 0.45);

    // Label.
    const l = SLAB_LABEL;
    fillRect(r, l.x, l.y, l.w, l.h, black ? BLACK_LABEL_INK.black : ASP_INK.paper);
    for (let y = l.y; y < l.y + l.h; y++)
      for (let x = l.x; x < l.x + l.w; x++)
        if ((x * 5 + y * 9) % 13 === 0) setPixel(r, x, y, black ? BLACK_LABEL_INK.shade : ASP_INK.paperShade);
    const band = black ? BLACK_LABEL_INK.silver : gold ? GOLD_INK.base : ASP_INK.brand;
    fillRect(r, l.x, l.y, l.w, 5, band);
    fillRect(r, l.x, l.y, l.w, 1, black ? BLACK_LABEL_INK.white : gold ? GOLD_INK.pale : ASP_INK.brandLight);
    fillRect(r, l.x, l.y + l.h - 2, l.w, 2, band);
    // The Black Label: a fine silver line inside the label and a glint in two corners.
    if (black) {
      strokeRect(r, l.x + 1, l.y + 6, l.w - 2, l.h - 9, BLACK_LABEL_INK.silverDark, 0.55);
      setPixel(r, l.x + 1, l.y + 6, BLACK_LABEL_INK.white);
      setPixel(r, l.x + l.w - 2, l.y + l.h - 4, BLACK_LABEL_INK.white);
    }
    // A One of One (ADR-174): an iridescent line under the band and above the foot of the label.
    if (oneOfOne)
      for (let x = l.x; x < l.x + l.w; x++) {
        const iris = ONE_OF_ONE_INK.iris;
        setPixel(r, x, l.y + 5, iris[Math.floor((x - l.x) / 5) % iris.length]!);
        setPixel(r, x, l.y + l.h - 3, iris[(Math.floor((x - l.x) / 5) + 2) % iris.length]!);
      }
    strokeRect(r, l.x - 1, l.y - 1, l.w + 2, l.h + 2, "#5f7690", 0.8);
    if (back) {
      drawAspEmblem(r, l.x + 4, l.y + 6, tier);
      drawMicroText(r, "ASP", l.x + 25, l.y + 8, black ? BLACK_LABEL_INK.silver : ASP_INK.brandDark, 2);
      // A row of bars like a printed code.
      const rand = rng(17);
      for (let x = l.x + 51; x < l.x + l.w - 3; x++)
        if (rand() > 0.45) fillRect(r, x, l.y + 8, 1, 10, black ? BLACK_LABEL_INK.silver : ASP_INK.ink);
    } else {
      drawAspEmblem(r, l.x + 2, l.y + 6, tier);
      // The box of the grade on the right.
      fillRect(r, l.x + l.w - 18, l.y + 6, 16, 14, black ? BLACK_LABEL_INK.black : gold ? GOLD_INK.pale : "#ffffff");
      strokeRect(r, l.x + l.w - 18, l.y + 6, 16, 14, band);
    }
    roundCorners(r, 4);
    return r;
  };
  const out = { front: build(false), back: build(true) };
  slabCache.set(cacheKey, out);
  return out;
}

// ------------------------------------------------------------------ grading package

let gradingPackCache: PackRasters | null = null;

/**
 * The sealed package a graded card comes back in (ADR-165): a foil pack in ASP's teal with the seal in the
 * middle, split like a booster pack into the strip that tears off and the rest. It never shows the grade.
 */
export function composeGradingPack(): PackRasters {
  if (gradingPackCache) return gradingPackCache;
  const ink = {
    deep: ASP_INK.brandDark,
    dark: "#0b524c",
    base: ASP_INK.brand,
    light: "#1f9c8d",
    pale: ASP_INK.brandLight,
  };
  const full = createRaster(PW, PH);
  ditherRect(full, 0, 0, PW, PH, [ink.deep, ink.dark, ink.base, ink.dark, ink.deep]);
  // Fine diagonal security lines, like on a sealed document.
  for (let y = CRIMP; y < PH - CRIMP; y++)
    for (let x = 1; x < PW - 1; x++) if ((x + y) % 6 === 0) setPixel(full, x, y, ink.light, 0.45);
  // A ring of light and the big seal in the middle.
  const cx = 37.5;
  const cy = 58;
  for (let y = 30; y < 88; y++)
    for (let x = 4; x < PW - 4; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const ray = Math.sin(Math.atan2(y - cy, x - cx) * 12);
      if (d < 27 && d > 14 && ray > 0.1 && bayer(x, y) > d / 34) setPixel(full, x, y, ink.pale, 0.8);
      if (d <= 14) setPixel(full, x, y, d > 12.5 ? GOLD_INK.deep : d > 11 ? GOLD_INK.pale : GOLD_INK.base);
    }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    setPixel(full, Math.round(cx + Math.cos(a) * 9.5), Math.round(cy + Math.sin(a) * 9.5), GOLD_INK.deep);
  }
  drawMicroTextCentered(full, "ASP", PW / 2 + 1, cy - 4, GOLD_INK.pale, 2);
  drawMicroTextCentered(full, "ASP", PW / 2, cy - 5, GOLD_INK.deep, 2);
  // Title band and the bottom line.
  fillRect(full, 0, CRIMP + 3, PW, 16, ink.deep, 0.7);
  fillRect(full, 0, CRIMP + 3, PW, 1, ink.pale, 0.7);
  fillRect(full, 0, CRIMP + 18, PW, 1, ink.pale, 0.7);
  drawMicroTextCentered(full, "GRADED", PW / 2 + 1, CRIMP + 7, ink.deep, 2);
  drawMicroTextCentered(full, "GRADED", PW / 2, CRIMP + 6, "#ffffff", 2);
  fillRect(full, 0, PH - CRIMP - 13, PW, 9, ink.deep, 0.75);
  fillRect(full, 0, PH - CRIMP - 13, PW, 1, ink.pale, 0.6);
  drawMicroTextCentered(full, "SEALED BY ASP", PW / 2, PH - CRIMP - 11, ink.pale);
  // A tamper strip with a question mark where the grade would be.
  fillRect(full, 26, 78, 24, 9, "#ffffff", 0.92);
  strokeRect(full, 26, 78, 24, 9, ink.deep);
  drawMicroTextCentered(full, "? ? ?", PW / 2, 80, ink.deep);

  // Crimped seals and foil edges, as on a booster pack.
  for (const y0 of [0, PH - CRIMP]) {
    for (let y = y0; y < y0 + CRIMP; y++)
      for (let x = 0; x < PW; x++) setPixel(full, x, y, x % 3 === 0 ? ink.dark : x % 3 === 1 ? ink.base : ink.light);
    fillRect(full, 0, y0 === 0 ? CRIMP - 1 : y0, PW, 1, ink.deep, 0.75);
    fillRect(full, 0, y0 === 0 ? CRIMP : y0 - 1, PW, 1, "#ffffff", 0.35);
  }
  for (let x = 0; x < PW; x++)
    if (x % 4 < 2) {
      clearPixel(full, x, 0);
      clearPixel(full, x, PH - 1);
    }
  fillRect(full, 0, 1, 1, PH - 2, ink.deep, 0.8);
  fillRect(full, PW - 1, 1, 1, PH - 2, ink.deep, 0.8);
  fillRect(full, 1, CRIMP, 1, PH - 2 * CRIMP, "#ffffff", 0.3);

  const top = createRaster(PW, PH);
  const body = createRaster(PW, PH);
  for (let x = 0; x < PW; x++) {
    const tear = packTearRow(x);
    for (let y = 0; y < PH; y++) {
      const i = (y * PW + x) * 4;
      (y < tear ? top : body).data.set(full.data.subarray(i, i + 4), i);
    }
    if (isOpaque(top, x, tear - 1)) setPixel(top, x, tear - 1, "#ffffff", 0.85);
    setPixel(body, x, tear, "#ffffff", 0.85);
  }
  gradingPackCache = { full, top, body };
  return gradingPackCache;
}
