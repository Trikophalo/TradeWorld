import { describe, expect, it } from "vitest";

import { COSMIC_WINDS_COMMONS_ART, COSMIC_WINDS_COMMONS_CARDS } from "./cards-cosmic-winds-commons";
import { COSMIC_ART_SIZE, COSMIC_PRICE_RANGE } from "./cosmic-draft";

const cards = COSMIC_WINDS_COMMONS_CARDS;
const byKey = new Map(cards.map((c) => [c.key, c]));

describe("Cosmic Winds commons", () => {
  it("has cards 1-50, all common, with matching keys", () => {
    expect(cards.map((c) => c.number)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    for (const c of cards) {
      expect(c.key).toBe(`cw-${String(c.number).padStart(3, "0")}`);
      expect(c.rarity).toBe("common");
    }
    expect(new Set(cards.map((c) => c.name)).size).toBe(50);
  });

  it("keeps start prices inside the common range", () => {
    const [min, max] = COSMIC_PRICE_RANGE.common;
    for (const c of cards) {
      expect(Number.isInteger(c.startPriceCents)).toBe(true);
      expect(c.startPriceCents).toBeGreaterThanOrEqual(min);
      expect(c.startPriceCents).toBeLessThanOrEqual(max);
    }
  });

  it("gives event cards their fixed fields, about one in five slots", () => {
    const events = cards.filter((c) => c.kind === "event");
    expect(events.length).toBeGreaterThanOrEqual(8);
    expect(events.length).toBeLessThanOrEqual(12);
    for (const e of events) {
      expect(e).toMatchObject({ type: "cosmic", hp: 0, stage: 0, evolvesFrom: null });
      expect(e.attack.damage).toBe(0);
      expect(e.attack.name.length).toBeGreaterThan(0);
      expect(e.attack.text.length).toBeGreaterThan(0);
    }
  });

  it("builds valid evolution lines, including the fixed ones", () => {
    for (const c of cards.filter((x) => x.kind === "monster")) {
      expect(c.hp).toBeGreaterThan(0);
      if (c.stage === 0) {
        expect(c.evolvesFrom).toBeNull();
      } else {
        const prev = byKey.get(c.evolvesFrom ?? "");
        expect(prev?.kind).toBe("monster");
        expect(prev?.stage).toBe(c.stage - 1);
        expect(prev?.number ?? 99).toBeLessThan(c.number);
      }
    }
    const fixed: [string, string, string][] = [
      ["cw-001", "cw-002", "Funkelfuchs"],
      ["cw-010", "cw-011", "Kometschwinge"],
      ["cw-020", "cw-021", "Astrogolem"],
      ["cw-030", "cw-031", "Sternwal"],
      ["cw-040", "cw-041", "Polarlichtschlange"],
    ];
    for (const [base, next, name] of fixed) {
      expect(byKey.get(base)?.name).toBe(name);
      expect(byKey.get(base)?.stage).toBe(0);
      expect(byKey.get(next)?.evolvesFrom).toBe(base);
      expect(byKey.get(next)?.stage).toBe(1);
    }
  });

  it("keeps flavour texts short", () => {
    for (const c of cards) {
      expect(c.flavor.length).toBeGreaterThan(0);
      expect(c.flavor.length).toBeLessThanOrEqual(110);
    }
  });

  it("has complete artwork in the common size", () => {
    const { width, height } = COSMIC_ART_SIZE.common;
    expect(Object.keys(COSMIC_WINDS_COMMONS_ART).sort()).toEqual(cards.map((c) => c.key).sort());
    for (const [key, art] of Object.entries(COSMIC_WINDS_COMMONS_ART)) {
      expect([art.width, art.height], key).toEqual([width, height]);
      expect(art.grid).toHaveLength(height);
      expect(Object.keys(art.palette).length).toBeLessThanOrEqual(40);
      for (const hex of Object.values(art.palette)) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      for (const row of art.grid) {
        expect(row).toHaveLength(width);
        for (const ch of row) expect(ch === "." || ch in art.palette, `${key} ${ch}`).toBe(true);
      }
    }
  });
});
