import { describe, expect, it } from "vitest";
import {
  NEXAMON_ART,
  NEXAMON_ART_SIZE,
  NEXAMON_CARDS,
  NEXAMON_RARITIES,
  NEXAMON_SET_LAYOUT,
  NEXAMON_SETS,
  nexamonCardKind,
  nexamonKey,
  nexamonPriceRange,
  nexamonRarityCount,
  nexamonRarityOfNumber,
  nexamonRarityRange,
  nexamonSetSize,
} from "./index";
import { BALANCE } from "../balance";
import { nexamonExpectedPackValue } from "../../lib/sim/nexamon";
import {
  TITAN_ART_SIZE,
  TITAN_PRICE_RANGE,
  TITAN_REBALANCE_FACTOR,
  TITAN_VALUE_FACTOR,
  type TitanRarity,
} from "./titans-draft";
import { TITANS_REVENGE_CARDS as TITAN_DRAFTS } from "./cards-titans-revenge-data";
import { YINYANG_ART_SIZE, YINYANG_PRICE_RANGE } from "./yinyang-draft";

describe("Nexamon catalogue (ADR-165, ADR-174)", () => {
  it("has a rarity layout per set: 77 cards in the first three, 90 in Cosmic Winds", () => {
    expect(NEXAMON_SETS.map(nexamonSetSize)).toEqual([77, 77, 77, 90, 30, 110]);
    expect(Object.fromEntries(NEXAMON_SET_LAYOUT.cosmic_winds)).toEqual({
      common: 50,
      rare: 15,
      ultra: 15,
      prisma: 5,
      legendary: 2,
      one_of_one: 3,
    });
    expect(nexamonRarityRange("super_apex", "legendary")).toEqual([76, 77]);
    expect(nexamonRarityRange("super_apex", "one_of_one")).toBeNull();
    expect(
      (["common", "rare", "ultra", "prisma", "legendary", "one_of_one"] as const).map((r) =>
        nexamonRarityRange("cosmic_winds", r),
      ),
    ).toEqual([
      [1, 50],
      [51, 65],
      [66, 80],
      [81, 85],
      [86, 87],
      [88, 90],
    ]);
    expect(nexamonRarityOfNumber(60)).toBe("rare");
    expect(nexamonRarityOfNumber(61)).toBe("ultra");
    expect(nexamonRarityOfNumber(61, "cosmic_winds")).toBe("rare");
    expect(nexamonRarityOfNumber(88, "cosmic_winds")).toBe("one_of_one");
  });

  it("has every set's cards with the rarities in card-number order and unique keys", () => {
    const total = NEXAMON_SETS.reduce((n, s) => n + nexamonSetSize(s), 0);
    expect(new Set(NEXAMON_CARDS.map((c) => c.key)).size).toBe(total);
    expect(NEXAMON_CARDS).toHaveLength(total);
    for (const set of NEXAMON_SETS) {
      const cards = NEXAMON_CARDS.filter((c) => c.set === set);
      expect(cards.map((c) => c.number)).toEqual(Array.from({ length: nexamonSetSize(set) }, (_, i) => i + 1));
      for (const card of cards) {
        expect(card.key).toBe(nexamonKey(set, card.number));
        expect(card.rarity, card.key).toBe(nexamonRarityOfNumber(card.number, set));
        if (card.evolvesFrom)
          expect(
            cards.some((c) => c.key === card.evolvesFrom),
            card.key,
          ).toBe(true);
        expect(card.flavor.length, card.key).toBeLessThanOrEqual(110);
        if (nexamonCardKind(card) === "event") {
          expect(card.hp, card.key).toBe(0);
          expect(card.attack.damage, card.key).toBe(0);
        } else expect(card.hp, card.key).toBeGreaterThan(0);
      }
      for (const rarity of NEXAMON_RARITIES)
        expect(cards.filter((c) => c.rarity === rarity)).toHaveLength(nexamonRarityCount(set, rarity));
    }
    expect(NEXAMON_CARDS.some((c) => c.set === "cosmic_winds" && nexamonCardKind(c) === "event")).toBe(true);
  });

  it("has the layouts of Titans Revenge and Yin Yang (ADR-182)", () => {
    expect(NEXAMON_SET_LAYOUT.titans_revenge).toEqual([
      ["iron", 15],
      ["titanium", 7],
      ["diamond", 4],
      ["uranium", 4],
    ]);
    expect(Object.fromEntries(NEXAMON_SET_LAYOUT.yin_yang)).toEqual(
      Object.fromEntries([
        ["common", 54],
        ["rare", 30],
        ["ultra", 16],
        ["prisma", 8],
        ["legendary", 2],
      ]),
    );
    expect(nexamonRarityRange("titans_revenge", "uranium")).toEqual([27, 30]);
    expect(nexamonRarityRange("yin_yang", "legendary")).toEqual([109, 110]);
    expect(nexamonRarityOfNumber(16, "titans_revenge")).toBe("titanium");
    expect(nexamonRarityOfNumber(101, "yin_yang")).toBe("prisma");
    expect(NEXAMON_CARDS.find((c) => c.key === "yy-109")?.name).toBe("Yin");
    expect(NEXAMON_CARDS.find((c) => c.key === "yy-110")?.name).toBe("Yang");
    const warriors = NEXAMON_CARDS.filter((c) => nexamonCardKind(c) === "warrior");
    expect(warriors.length).toBeGreaterThan(10);
    expect(warriors.every((c) => c.set === "yin_yang" && c.hp > 0)).toBe(true);
  });

  it("takes the ranges of Titans Revenge and Yin Yang from their drafts", () => {
    for (const rarity of ["iron", "titanium", "diamond", "uranium"] as const)
      expect(nexamonPriceRange("titans_revenge", rarity)).toEqual(
        TITAN_PRICE_RANGE[rarity].map((p) => Math.round(p * TITAN_VALUE_FACTOR * TITAN_REBALANCE_FACTOR[rarity])),
      );
    for (const rarity of ["common", "rare", "ultra", "prisma", "legendary"] as const)
      expect(nexamonPriceRange("yin_yang", rarity)).toEqual(YINYANG_PRICE_RANGE[rarity]);
    for (const rarity of ["iron", "titanium", "diamond", "uranium"] as const)
      expect(NEXAMON_ART_SIZE[rarity]).toEqual(TITAN_ART_SIZE[rarity]);
    for (const rarity of ["common", "rare", "ultra", "prisma", "legendary"] as const)
      expect(NEXAMON_ART_SIZE[rarity]).toEqual(YINYANG_ART_SIZE[rarity]);
  });

  it("gives a Titans Revenge pack about 90 % of its price in start values (ADR-182)", () => {
    const price = BALANCE.nexamon.sets.titans_revenge.packPriceCents;
    const titans = nexamonExpectedPackValue(
      NEXAMON_CARDS.filter((c) => c.set === "titans_revenge"),
      "titans_revenge",
    );
    expect(titans.cents / price).toBeGreaterThan(0.88);
    expect(titans.cents / price).toBeLessThan(0.92);
    // Yin Yang stays a winner on average, like the other sets (value factor 10)
    const yy = nexamonExpectedPackValue(
      NEXAMON_CARDS.filter((c) => c.set === "yin_yang"),
      "yin_yang",
    );
    expect(yy.cents / BALANCE.nexamon.sets.yin_yang.packPriceCents).toBeGreaterThan(1.5);
  });

  it("rebalances Titans Revenge: diamond x 1.3, uranium lower, the pack's expected value unchanged (ADR-207)", () => {
    const titans = NEXAMON_CARDS.filter((c) => c.set === "titans_revenge");
    // the catalogue before ADR-207: drafts x 1.125, rounded to whole euros
    const before = TITAN_DRAFTS.map((d) => ({
      rarity: d.rarity,
      startPriceCents: Math.round((d.startPriceCents * TITAN_VALUE_FACTOR) / 100) * 100,
    }));
    const evBefore = nexamonExpectedPackValue(before, "titans_revenge").cents;
    const evAfter = nexamonExpectedPackValue(titans, "titans_revenge").cents;
    expect(Math.abs(evAfter - evBefore)).toBeLessThan(100); // under 1 EUR per pack (whole-euro rounding)
    expect(evBefore).toBeCloseTo(8_990_125, 0); // 89.901,25 EUR = 89,9 % of 100.000 EUR
    const mean = (cards: readonly { rarity: string; startPriceCents: number }[], r: string) => {
      const pool = cards.filter((c) => c.rarity === r);
      return pool.reduce((a, c) => a + c.startPriceCents, 0) / pool.length;
    };
    expect(mean(titans, "diamond") / mean(before, "diamond")).toBeCloseTo(1.3, 4);
    expect(mean(titans, "uranium") / mean(before, "uranium")).toBeCloseTo(0.918828, 4);
    // the factor follows from the numbers: 0.3 x mean(diamond) / 50 = (1 - u) x mean(uranium) / 500
    expect(1 - (0.3 * mean(before, "diamond") * 10) / mean(before, "uranium")).toBeCloseTo(
      TITAN_REBALANCE_FACTOR.uranium,
      6,
    );
    // per-card ratios within a rarity stay, iron and titanium do not change
    for (const c of titans) {
      const b = before.find((_, i) => TITAN_DRAFTS[i]!.key === c.key)!;
      if (c.rarity === "iron" || c.rarity === "titanium") expect(c.startPriceCents).toBe(b.startPriceCents);
      else
        expect(
          Math.abs(c.startPriceCents / b.startPriceCents - TITAN_REBALANCE_FACTOR[c.rarity as TitanRarity]),
        ).toBeLessThan(1e-5);
    }
  });

  it("keeps every start price inside the range of its rarity and set", () => {
    for (const card of NEXAMON_CARDS) {
      const [lo, hi] = nexamonPriceRange(card.set, card.rarity);
      expect(card.startPriceCents, card.key).toBeGreaterThanOrEqual(lo);
      expect(card.startPriceCents, card.key).toBeLessThanOrEqual(hi);
    }
    expect(nexamonPriceRange("cosmic_winds", "one_of_one")).toEqual([1_600_000_000, 3_300_000_000]);
    expect(nexamonPriceRange("cosmic_winds", "common")).toEqual([2_250, 22_500]);
  });

  it("has artwork of the right size with a complete palette for every card", () => {
    for (const card of NEXAMON_CARDS) expect(NEXAMON_ART[card.key], card.key).toBeDefined();
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
  }, 30_000);
});
