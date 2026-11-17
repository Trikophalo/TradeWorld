import { describe, expect, it } from "vitest";

import { COSMIC_WINDS_RARES_ULTRAS_ART, COSMIC_WINDS_RARES_ULTRAS_CARDS } from "./cards-cosmic-winds-rares-ultras";
import { COSMIC_ART_SIZE, COSMIC_PRICE_RANGE } from "./cosmic-draft";

const cards = COSMIC_WINDS_RARES_ULTRAS_CARDS;

describe("Cosmic Winds rares and ultras", () => {
  it("has cards 51-80 with matching keys and rarities", () => {
    expect(cards.map((c) => c.number)).toEqual(Array.from({ length: 30 }, (_, i) => 51 + i));
    for (const c of cards) {
      expect(c.key).toBe(`cw-${String(c.number).padStart(3, "0")}`);
      expect(c.rarity).toBe(c.number <= 65 ? "rare" : "ultra");
    }
    expect(new Set(cards.map((c) => c.name)).size).toBe(cards.length);
  });

  it("keeps start prices inside the rarity range", () => {
    for (const c of cards) {
      const [lo, hi] = COSMIC_PRICE_RANGE[c.rarity];
      expect(c.startPriceCents, c.key).toBeGreaterThanOrEqual(lo);
      expect(c.startPriceCents, c.key).toBeLessThanOrEqual(hi);
      expect(Number.isInteger(c.startPriceCents)).toBe(true);
    }
  });

  it("fills event and monster fields correctly", () => {
    const events = cards.filter((c) => c.kind === "event");
    expect(events.length).toBe(6);
    for (const c of events) {
      expect(c).toMatchObject({ type: "cosmic", hp: 0, stage: 0, evolvesFrom: null });
      expect(c.attack.damage).toBe(0);
      expect(c.attack.text.length).toBeGreaterThan(0);
    }
    for (const c of cards.filter((c) => c.kind === "monster")) {
      expect(c.hp).toBeGreaterThan(0);
      expect(c.stage === 0).toBe(c.evolvesFrom === null);
    }
    expect(cards.find((c) => c.number === 51)?.evolvesFrom).toBe("cw-002");
    expect(cards.find((c) => c.number === 66)?.evolvesFrom).toBe("cw-011");
    expect(cards.find((c) => c.number === 70)?.evolvesFrom).toBe("cw-021");
  });

  it("keeps flavour texts short", () => {
    for (const c of cards) {
      expect(c.flavor.length, c.key).toBeLessThanOrEqual(110);
      expect(c.flavor.length).toBeGreaterThan(0);
    }
  });

  it("has artwork of the right size with a complete palette", () => {
    for (const c of cards) {
      const art = COSMIC_WINDS_RARES_ULTRAS_ART[c.key];
      expect(art, c.key).toBeDefined();
      if (!art) continue;
      const { width, height } = COSMIC_ART_SIZE[c.rarity];
      expect(art.width).toBe(width);
      expect(art.height).toBe(height);
      expect(art.grid.length).toBe(height);
      expect(Object.keys(art.palette).length).toBeLessThanOrEqual(40);
      for (const row of art.grid) {
        expect(row.length).toBe(width);
        for (const ch of row) if (ch !== ".") expect(art.palette[ch], `${c.key} ${ch}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    expect(Object.keys(COSMIC_WINDS_RARES_ULTRAS_ART).sort()).toEqual(cards.map((c) => c.key));
  });
});
