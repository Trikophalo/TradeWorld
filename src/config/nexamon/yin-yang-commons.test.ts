import { describe, expect, it } from "vitest";

import { YIN_YANG_COMMONS_ART, YIN_YANG_COMMONS_CARDS } from "./cards-yin-yang-commons";
import { NEXAMON_TYPES } from "./types";
import { YINYANG_ART_SIZE, YINYANG_PRICE_RANGE } from "./yinyang-draft";

const CARDS = YIN_YANG_COMMONS_CARDS;
const byKey = new Map(CARDS.map((c) => [c.key, c]));

describe("Yin Yang commons", () => {
  it("covers yy-001 to yy-054 as commons, in order", () => {
    expect(CARDS.map((c) => c.number)).toEqual(Array.from({ length: 54 }, (_, i) => i + 1));
    for (const c of CARDS) {
      expect(c.key).toBe(`yy-${String(c.number).padStart(3, "0")}`);
      expect(c.rarity).toBe("common");
      expect(NEXAMON_TYPES).toContain(c.type);
      expect(["monster", "warrior"]).toContain(c.kind);
    }
    expect(new Set(CARDS.map((c) => c.name)).size).toBe(CARDS.length);
  });

  it("mixes warriors and monsters", () => {
    const warriors = CARDS.filter((c) => c.kind === "warrior").length;
    expect(warriors).toBeGreaterThanOrEqual(20);
    expect(warriors).toBeLessThanOrEqual(34);
  });

  it("keeps prices, HP and flavour in range", () => {
    const [lo, hi] = YINYANG_PRICE_RANGE.common;
    for (const c of CARDS) {
      expect(c.startPriceCents).toBeGreaterThanOrEqual(lo);
      expect(c.startPriceCents).toBeLessThanOrEqual(hi);
      expect(Number.isInteger(c.startPriceCents)).toBe(true);
      expect(c.hp).toBeGreaterThanOrEqual(40);
      expect(c.hp).toBeLessThanOrEqual(140);
      expect(c.flavor.length).toBeGreaterThan(0);
      expect(c.flavor.length).toBeLessThanOrEqual(110);
      expect(c.attack.name.length).toBeGreaterThan(0);
    }
    expect(new Set(CARDS.map((c) => c.startPriceCents)).size).toBeGreaterThan(40);
  });

  it("links evolutions inside the part", () => {
    for (const c of CARDS) {
      if (c.stage === 0) {
        expect(c.evolvesFrom).toBeNull();
        continue;
      }
      const prev = byKey.get(c.evolvesFrom ?? "");
      expect(prev, c.key).toBeDefined();
      expect(prev!.stage).toBe(c.stage - 1);
      expect(prev!.kind).toBe(c.kind);
      expect(prev!.number).toBeLessThan(c.number);
    }
  });

  it("starts the cross-part lines with stage 0 and 1", () => {
    const lines: [number, number][] = [
      [1, 2],
      [10, 11],
      [20, 21],
      [30, 31],
      [40, 41],
    ];
    for (const [a, b] of lines) {
      const k = (n: number) => `yy-${String(n).padStart(3, "0")}`;
      expect(byKey.get(k(a))!.stage).toBe(0);
      expect(byKey.get(k(b))!.stage).toBe(1);
      expect(byKey.get(k(b))!.evolvesFrom).toBe(k(a));
    }
  });

  it("has a complete 60 x 40 artwork for every card", () => {
    const { width, height } = YINYANG_ART_SIZE.common;
    expect(Object.keys(YIN_YANG_COMMONS_ART).sort()).toEqual(CARDS.map((c) => c.key).sort());
    for (const c of CARDS) {
      const art = YIN_YANG_COMMONS_ART[c.key]!;
      expect(art.width).toBe(width);
      expect(art.height).toBe(height);
      expect(art.grid).toHaveLength(height);
      expect(Object.keys(art.palette).length).toBeLessThanOrEqual(40);
      for (const value of Object.values(art.palette)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
      for (const row of art.grid) {
        expect(row).toHaveLength(width);
        for (const ch of row) if (ch !== ".") expect(art.palette[ch], `${c.key} '${ch}'`).toBeDefined();
      }
    }
  });
});
