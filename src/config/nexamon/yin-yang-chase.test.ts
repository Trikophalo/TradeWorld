import { describe, expect, it } from "vitest";
import { YIN_YANG_CHASE_ART, YIN_YANG_CHASE_CARDS } from "./cards-yin-yang-chase";
import { YINYANG_ART_SIZE, YINYANG_PRICE_RANGE } from "./yinyang-draft";

/** Final forms whose earlier stages live in the commons part. */
const CROSS_PART = new Set(["yy-021", "yy-031", "yy-041"]);

describe("Yin Yang chase cards (85-110)", () => {
  it("covers cards 85-110 with keys and rarities in number order", () => {
    expect(YIN_YANG_CHASE_CARDS.map((c) => c.number)).toEqual(Array.from({ length: 26 }, (_, i) => 85 + i));
    for (const card of YIN_YANG_CHASE_CARDS) {
      expect(card.key).toBe(`yy-${String(card.number).padStart(3, "0")}`);
      const expected = card.number <= 100 ? "ultra" : card.number <= 108 ? "prisma" : "legendary";
      expect(card.rarity, card.key).toBe(expected);
    }
    expect(YIN_YANG_CHASE_CARDS.find((c) => c.number === 109)?.name).toBe("Yin");
    expect(YIN_YANG_CHASE_CARDS.find((c) => c.number === 110)?.name).toBe("Yang");
  });

  it("keeps prices in range, flavour short and evolution links valid", () => {
    const keys = new Set(YIN_YANG_CHASE_CARDS.map((c) => c.key));
    for (const card of YIN_YANG_CHASE_CARDS) {
      const [lo, hi] = YINYANG_PRICE_RANGE[card.rarity];
      expect(card.startPriceCents, card.key).toBeGreaterThanOrEqual(lo);
      expect(card.startPriceCents, card.key).toBeLessThanOrEqual(hi);
      expect(card.flavor.length, card.key).toBeLessThanOrEqual(110);
      expect(card.name.length, card.key).toBeGreaterThan(0);
      if (card.evolvesFrom) {
        expect(keys.has(card.evolvesFrom) || CROSS_PART.has(card.evolvesFrom), card.key).toBe(true);
        expect(card.stage, card.key).toBeGreaterThan(0);
      } else expect(card.stage, card.key).toBe(0);
    }
    expect(new Set(YIN_YANG_CHASE_CARDS.map((c) => c.startPriceCents)).size).toBe(26);
  });

  it("has artwork of the right size with a complete palette for every card", () => {
    expect(Object.keys(YIN_YANG_CHASE_ART).sort()).toEqual(YIN_YANG_CHASE_CARDS.map((c) => c.key).sort());
    for (const card of YIN_YANG_CHASE_CARDS) {
      const art = YIN_YANG_CHASE_ART[card.key]!;
      const size = YINYANG_ART_SIZE[card.rarity];
      expect([art.width, art.height], card.key).toEqual([size.width, size.height]);
      expect(art.grid, card.key).toHaveLength(size.height);
      expect(Object.keys(art.palette).length, card.key).toBeLessThanOrEqual(40);
      for (const row of art.grid) {
        expect(row.length, card.key).toBe(size.width);
        for (const ch of row) if (ch !== ".") expect(art.palette[ch], `${card.key} ${ch}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});
