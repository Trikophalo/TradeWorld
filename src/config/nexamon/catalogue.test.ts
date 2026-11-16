import { describe, expect, it } from "vitest";
import {
  NEXAMON_ART,
  NEXAMON_ART_SIZE,
  NEXAMON_BASE_PRICE_RANGE,
  NEXAMON_CARDS,
  NEXAMON_RARITY_COUNTS,
  NEXAMON_SET_PRICE_FACTOR,
  NEXAMON_SETS,
  nexamonKey,
  nexamonRarityOfNumber,
} from "./index";

describe("Nexamon catalogue (ADR-165)", () => {
  it("has 77 cards per set with the rarities in card-number order and unique keys", () => {
    expect(new Set(NEXAMON_CARDS.map((c) => c.key)).size).toBe(231);
    for (const set of NEXAMON_SETS) {
      const cards = NEXAMON_CARDS.filter((c) => c.set === set);
      expect(cards.map((c) => c.number)).toEqual(Array.from({ length: 77 }, (_, i) => i + 1));
      for (const card of cards) {
        expect(card.key).toBe(nexamonKey(set, card.number));
        expect(card.rarity).toBe(nexamonRarityOfNumber(card.number));
        if (card.evolvesFrom)
          expect(
            cards.some((c) => c.key === card.evolvesFrom),
            card.key,
          ).toBe(true);
        expect(card.flavor.length, card.key).toBeLessThanOrEqual(110);
      }
      for (const [rarity, count] of Object.entries(NEXAMON_RARITY_COUNTS))
        expect(cards.filter((c) => c.rarity === rarity)).toHaveLength(count);
    }
  });

  it("keeps every start price inside the range of its rarity and set", () => {
    for (const card of NEXAMON_CARDS) {
      const [lo, hi] = NEXAMON_BASE_PRICE_RANGE[card.rarity];
      const factor = NEXAMON_SET_PRICE_FACTOR[card.set];
      expect(card.startPriceCents, card.key).toBeGreaterThanOrEqual(lo * factor);
      expect(card.startPriceCents, card.key).toBeLessThanOrEqual(hi * factor);
    }
  });

  it("has artwork of the right size with a complete palette", () => {
    for (const [key, art] of Object.entries(NEXAMON_ART)) {
      const card = NEXAMON_CARDS.find((c) => c.key === key);
      expect(card, key).toBeDefined();
      const size = NEXAMON_ART_SIZE[card!.rarity];
      expect([art.width, art.height], key).toEqual([size.width, size.height]);
      expect(art.grid, key).toHaveLength(size.height);
      for (const row of art.grid) {
        expect(row.length, key).toBe(size.width);
        for (const ch of row) if (ch !== ".") expect(art.palette[ch], `${key} '${ch}'`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});
