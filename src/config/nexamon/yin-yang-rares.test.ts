import { describe, expect, it } from "vitest";

import { YIN_YANG_RARES_ART, YIN_YANG_RARES_CARDS } from "./cards-yin-yang-rares";
import { YINYANG_ART_SIZE, YINYANG_PRICE_RANGE } from "./yinyang-draft";

const CROSS_PART = new Set(["yy-002", "yy-011"]);

describe("Yin Yang rares", () => {
  it("covers cards 55-84 as rares with matching keys", () => {
    expect(YIN_YANG_RARES_CARDS.map((c) => c.number)).toEqual(Array.from({ length: 30 }, (_, i) => 55 + i));
    for (const c of YIN_YANG_RARES_CARDS) {
      expect(c.key).toBe(`yy-${String(c.number).padStart(3, "0")}`);
      expect(c.rarity).toBe("rare");
    }
  });

  it("keeps prices in range and flavour short", () => {
    const [lo, hi] = YINYANG_PRICE_RANGE.rare;
    for (const c of YIN_YANG_RARES_CARDS) {
      expect(c.startPriceCents).toBeGreaterThanOrEqual(lo);
      expect(c.startPriceCents).toBeLessThanOrEqual(hi);
      expect(c.flavor.length).toBeLessThanOrEqual(110);
    }
  });

  it("links evolutions to an earlier stage", () => {
    const byKey = new Map(YIN_YANG_RARES_CARDS.map((c) => [c.key, c]));
    for (const c of YIN_YANG_RARES_CARDS) {
      if (c.stage === 0) {
        expect(c.evolvesFrom).toBeNull();
        continue;
      }
      expect(c.evolvesFrom).not.toBeNull();
      const from = byKey.get(c.evolvesFrom!);
      if (from) expect(from.stage).toBe(c.stage - 1);
      else expect(CROSS_PART.has(c.evolvesFrom!)).toBe(true);
    }
  });

  it("has complete artwork of the right size", () => {
    const { width, height } = YINYANG_ART_SIZE.rare;
    for (const c of YIN_YANG_RARES_CARDS) {
      const art = YIN_YANG_RARES_ART[c.key]!;
      expect(art, c.key).toBeDefined();
      expect(art.width).toBe(width);
      expect(art.height).toBe(height);
      expect(art.grid).toHaveLength(height);
      expect(Object.keys(art.palette).length).toBeLessThanOrEqual(40);
      for (const row of art.grid) {
        expect(row).toHaveLength(width);
        for (const ch of row) if (ch !== ".") expect(art.palette[ch], `${c.key} ${ch}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});
