import { describe, expect, it } from "vitest";
import { COSMIC_WINDS_CHASE_ART, COSMIC_WINDS_CHASE_CARDS } from "./cards-cosmic-winds-chase";
import { COSMIC_ART_SIZE, COSMIC_PRICE_RANGE } from "./cosmic-draft";

const rarityOf = (n: number) => (n <= 85 ? "prisma" : n <= 87 ? "legendary" : "one_of_one");

describe("Cosmic Winds chase cards", () => {
  it("covers cw-081 to cw-090 with the fixed rarities", () => {
    expect(COSMIC_WINDS_CHASE_CARDS.map((c) => c.number)).toEqual([81, 82, 83, 84, 85, 86, 87, 88, 89, 90]);
    for (const c of COSMIC_WINDS_CHASE_CARDS) {
      expect(c.key).toBe(`cw-${String(c.number).padStart(3, "0")}`);
      expect(c.rarity).toBe(rarityOf(c.number));
    }
  });

  it("keeps prices inside the rarity range, all different", () => {
    for (const c of COSMIC_WINDS_CHASE_CARDS) {
      const [lo, hi] = COSMIC_PRICE_RANGE[c.rarity];
      expect(c.startPriceCents).toBeGreaterThanOrEqual(lo);
      expect(c.startPriceCents).toBeLessThanOrEqual(hi);
    }
    expect(new Set(COSMIC_WINDS_CHASE_CARDS.map((c) => c.startPriceCents)).size).toBe(10);
  });

  it("has valid event and monster fields and short flavour", () => {
    for (const c of COSMIC_WINDS_CHASE_CARDS) {
      expect(c.flavor.length).toBeLessThanOrEqual(110);
      if (c.kind === "event") {
        expect(c).toMatchObject({ type: "cosmic", hp: 0, stage: 0, evolvesFrom: null });
        expect(c.attack.damage).toBe(0);
        expect(c.attack.text.length).toBeGreaterThan(0);
      } else {
        expect(c.hp).toBeGreaterThan(0);
        expect(c.stage === 0).toBe(c.evolvesFrom === null);
      }
    }
  });

  it("has full-size art with complete palettes", () => {
    for (const c of COSMIC_WINDS_CHASE_CARDS) {
      const art = COSMIC_WINDS_CHASE_ART[c.key]!;
      const size = COSMIC_ART_SIZE[c.rarity];
      expect(art).toBeDefined();
      expect(art.width).toBe(size.width);
      expect(art.height).toBe(size.height);
      expect(art.grid).toHaveLength(size.height);
      expect(Object.keys(art.palette).length).toBeLessThanOrEqual(40);
      for (const row of art.grid) {
        expect(row).toHaveLength(size.width);
        for (const ch of row) if (ch !== ".") expect(art.palette[ch]).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});
