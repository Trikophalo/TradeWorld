import { describe, expect, it } from "vitest";
import { TITANS_REVENGE_ART, TITANS_REVENGE_CARDS } from "./cards-titans-revenge-data";
import { TITAN_ART_SIZE, TITAN_PRICE_RANGE, type TitanRarity } from "./titans-draft";

const rarityOf = (n: number): TitanRarity =>
  n <= 15 ? "iron" : n <= 22 ? "titanium" : n <= 26 ? "diamond" : "uranium";
const HP: Record<TitanRarity, readonly [number, number]> = {
  iron: [80, 150],
  titanium: [150, 220],
  diamond: [220, 300],
  uranium: [300, 400],
};

describe("Titans Revenge data", () => {
  it("has 30 numbered cards with keys tr-001 ... tr-030 and the rarity bands", () => {
    expect(TITANS_REVENGE_CARDS).toHaveLength(30);
    TITANS_REVENGE_CARDS.forEach((c, i) => {
      expect(c.number).toBe(i + 1);
      expect(c.key).toBe(`tr-${String(i + 1).padStart(3, "0")}`);
      expect(c.rarity).toBe(rarityOf(c.number));
    });
    expect(new Set(TITANS_REVENGE_CARDS.map((c) => c.name)).size).toBe(30);
  });

  it("keeps prices, HP, attacks and flavour in range", () => {
    for (const c of TITANS_REVENGE_CARDS) {
      const [lo, hi] = TITAN_PRICE_RANGE[c.rarity];
      expect(Number.isInteger(c.startPriceCents)).toBe(true);
      expect(c.startPriceCents).toBeGreaterThanOrEqual(lo);
      expect(c.startPriceCents).toBeLessThanOrEqual(hi);
      expect(c.hp).toBeGreaterThanOrEqual(HP[c.rarity][0]);
      expect(c.hp).toBeLessThanOrEqual(HP[c.rarity][1]);
      expect(c.attack.name.length).toBeGreaterThan(0);
      expect(c.attack.damage).toBeGreaterThan(0);
      expect(c.flavor.length).toBeGreaterThan(0);
      expect(c.flavor.length).toBeLessThanOrEqual(110);
    }
  });

  it("links evolutions to an earlier card of the stage before", () => {
    const byKey = new Map(TITANS_REVENGE_CARDS.map((c) => [c.key, c]));
    let lines = 0;
    for (const c of TITANS_REVENGE_CARDS) {
      if (c.evolvesFrom === null) {
        expect(c.stage).toBe(0);
        continue;
      }
      const from = byKey.get(c.evolvesFrom);
      expect(from).toBeDefined();
      expect(from!.number).toBeLessThan(c.number);
      expect(c.stage).toBe(from!.stage + 1);
      if (c.stage === 2) lines += 1;
    }
    expect(lines).toBeGreaterThanOrEqual(3);
  });

  it("has artwork of the right size with a complete palette for every card", () => {
    expect(Object.keys(TITANS_REVENGE_ART).sort()).toEqual(TITANS_REVENGE_CARDS.map((c) => c.key).sort());
    for (const c of TITANS_REVENGE_CARDS) {
      const art = TITANS_REVENGE_ART[c.key]!;
      const size = TITAN_ART_SIZE[c.rarity];
      expect(art.width).toBe(size.width);
      expect(art.height).toBe(size.height);
      expect(art.grid).toHaveLength(size.height);
      expect(Object.keys(art.palette).length).toBeLessThanOrEqual(40);
      for (const value of Object.values(art.palette)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
      for (const row of art.grid) {
        expect(row).toHaveLength(size.width);
        for (const ch of row) if (ch !== ".") expect(art.palette[ch], `${c.key} '${ch}'`).toBeDefined();
      }
    }
  });
});
