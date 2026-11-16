import { describe, expect, it } from "vitest";
import {
  BLACK_LABEL_INK,
  composeGradingPack,
  composePack,
  composeSlab,
  PACK_SIZE,
  SLAB_LABEL,
  slabTier,
} from "./nexamon-pack";
import { isOpaque, type Raster } from "./nexamon-raster";

const hexAt = (r: Raster, x: number, y: number) => {
  const i = (y * r.width + x) * 4;
  return "#" + [0, 1, 2].map((c) => r.data[i + c]!.toString(16).padStart(2, "0")).join("");
};

describe("slab labels (ADR-165)", () => {
  it("has three labels: plain, gold for a 10, black for the Black Label", () => {
    expect([1, 9, 10, 11].map(slabTier)).toEqual(["plain", "plain", "gold", "black"]);
    expect(composeSlab(3)).toBe(composeSlab(9));
    expect(composeSlab(10)).not.toBe(composeSlab(9));
    expect(composeSlab(11)).not.toBe(composeSlab(10));
  });

  it("draws the Black Label black with a silver band; the other labels stay as they were", () => {
    const l = SLAB_LABEL;
    const black = composeSlab(11).front;
    // the band on top is silver, the paper under it black
    expect(hexAt(black, l.x + 10, l.y + 2)).toBe(BLACK_LABEL_INK.silver);
    expect(hexAt(black, l.x + 30, l.y + 9)).toBe(BLACK_LABEL_INK.black);
    const gold = composeSlab(10).front;
    expect(hexAt(gold, l.x + 30, l.y + 9)).not.toBe(BLACK_LABEL_INK.black);
    expect(hexAt(gold, l.x + 10, l.y + 2)).not.toBe(BLACK_LABEL_INK.silver);
  });
});

describe("the grading package (ADR-165)", () => {
  it("is a pack of its own, split into the strip and the rest like a booster", () => {
    const pack = composeGradingPack();
    expect(composeGradingPack()).toBe(pack);
    expect(pack.full.width).toBe(PACK_SIZE.width);
    expect(pack.full.height).toBe(PACK_SIZE.height);
    expect(Buffer.from(pack.full.data).equals(Buffer.from(composePack("mystic_energy").full.data))).toBe(false);
    let full = 0;
    let parts = 0;
    for (let y = 0; y < PACK_SIZE.height; y++)
      for (let x = 0; x < PACK_SIZE.width; x++) {
        if (isOpaque(pack.full, x, y)) full++;
        if (isOpaque(pack.top, x, y)) parts++;
        if (isOpaque(pack.body, x, y)) parts++;
        // no pixel belongs to both pieces
        expect(isOpaque(pack.top, x, y) && isOpaque(pack.body, x, y)).toBe(false);
      }
    expect(full).toBeGreaterThan(PACK_SIZE.width * PACK_SIZE.height * 0.95);
    expect(parts).toBeGreaterThanOrEqual(full);
  });
});
