import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { NEXAMON_CONDITIONS, type NexamonCondition } from "../../config/nexamon-rules.ts";
import { NEXAMON_RARITIES, placeholderSet, type NexamonRarity } from "../../config/nexamon/types.ts";
import {
  nexamonAiAskCents,
  nexamonAiBuyChanceBps,
  nexamonAiBuyCounts,
  nexamonAiExpectedMinutes,
  nexamonAiMaxPriceCents,
  nexamonAiPremiumBps,
  nexamonExpectedGradeFactorBps,
  nexamonCapBps,
  nexamonCentsFromE4,
  nexamonClampValue,
  nexamonConditionBps,
  nexamonCopyFactorBps,
  nexamonCopyValueCents,
  nexamonDemandMilli,
  nexamonE4FromCents,
  nexamonExpectedPerPack,
  NEXAMON_BLACK_LABEL_GRADE,
  nexamonGradeChanceBps,
  nexamonGradeNumber,
  nexamonIsBlackLabel,
  nexamonGradingFeeCents,
  nexamonMarketFeeCents,
  nexamonOpenPack,
  nexamonPopularityBps,
  nexamonPressureBps,
  nexamonPriceIsPlausible,
  nexamonPricePerCardE4,
  nexamonQuickSellCents,
  nexamonRollCondition,
  nexamonRollGrade,
  nexamonSaleCounts,
  nexamonSeedCopies,
  nexamonSlotOdds,
  nexamonSlotRarity,
  nexamonValueAfterAiBuy,
  nexamonValueAfterPressure,
  nexamonValueAfterQuickSell,
  nexamonValueAfterSale,
  nexamonValueBounds,
  type NexamonSaleInput,
} from "./nexamon.ts";
import { createRng } from "./rng.ts";

const cfg = BALANCE.nexamon;
const DEN = cfg.odds.denominator;
const SET = placeholderSet("mystic_energy");

describe("Nexamon packs (ADR-165)", () => {
  it("has the exact slot odds: slots 1-3 common, slot 4 ultra/rare, slot 5 legendary/prisma/ultra/rare", () => {
    expect(DEN).toBe(3600);
    for (const slot of [1, 2, 3])
      expect(nexamonSlotOdds(slot)).toEqual({ common: 3600, rare: 0, ultra: 0, prisma: 0, legendary: 0 });
    expect(nexamonSlotOdds(4)).toEqual({ common: 2550, rare: 900, ultra: 150, prisma: 0, legendary: 0 });
    expect(nexamonSlotOdds(5)).toEqual({ common: 2501, rare: 900, ultra: 150, prisma: 45, legendary: 4 });
    for (const slot of [1, 2, 3, 4, 5])
      expect(Object.values(nexamonSlotOdds(slot)).reduce((a, b) => a + b, 0)).toBe(DEN);
  });

  it("gives per pack exactly 1/2 rare, 1/12 ultra, 1/80 prisma, 1/900 legendary in expectation", () => {
    const sum = (rarity: NexamonRarity) => [1, 2, 3, 4, 5].reduce((n, slot) => n + nexamonSlotOdds(slot)[rarity], 0);
    // exact, as integers over the denominator
    expect(sum("rare") * 2).toBe(DEN);
    expect(sum("ultra") * 12).toBe(DEN);
    expect(sum("prisma") * 80).toBe(DEN);
    expect(sum("legendary") * 900).toBe(DEN);
    expect(sum("common")).toBe(5 * DEN - DEN / 2 - DEN / 12 - DEN / 80 - DEN / 900);
    const expected = nexamonExpectedPerPack();
    expect(expected.rare).toBeCloseTo(1 / 2, 12);
    expect(expected.ultra).toBeCloseTo(1 / 12, 12);
    expect(expected.prisma).toBeCloseTo(1 / 80, 12);
    expect(expected.legendary).toBeCloseTo(1 / 900, 12);
    expect(expected.common).toBeGreaterThan(4.4);
  });

  it("maps every one of the 3600 rolls of a slot to its rarity", () => {
    for (const slot of [4, 5]) {
      const seen: Record<string, number> = {};
      for (let n = 0; n < DEN; n++) {
        const rarity = nexamonSlotRarity(slot, (n + 0.5) / DEN);
        seen[rarity] = (seen[rarity] ?? 0) + 1;
      }
      const odds = nexamonSlotOdds(slot);
      for (const rarity of NEXAMON_RARITIES) expect(seen[rarity] ?? 0, `${slot} ${rarity}`).toBe(odds[rarity]);
    }
    expect(nexamonSlotRarity(5, 0)).toBe("legendary");
    expect(nexamonSlotRarity(5, 3.999 / DEN)).toBe("legendary");
    expect(nexamonSlotRarity(5, 4 / DEN)).toBe("prisma");
    expect(nexamonSlotRarity(5, 49 / DEN)).toBe("ultra");
    expect(nexamonSlotRarity(5, 199 / DEN)).toBe("rare");
    expect(nexamonSlotRarity(5, 1099 / DEN)).toBe("common");
    expect(nexamonSlotRarity(5, 0.999999)).toBe("common");
    expect(nexamonSlotRarity(4, 0)).toBe("ultra");
    expect(nexamonSlotRarity(4, 150 / DEN)).toBe("rare");
    expect(nexamonSlotRarity(4, 1050 / DEN)).toBe("common");
    expect(nexamonSlotRarity(1, 0)).toBe("common");
    expect(nexamonSlotRarity(5, Number.NaN)).toBe("legendary");
    expect(nexamonSlotRarity(5, 7)).toBe("common");
  });

  it("opens packs of 5: commons first and all different, better cards only in slots 4 and 5", () => {
    const rng = createRng(165);
    for (let i = 0; i < 2000; i++) {
      const pack = nexamonOpenPack(SET, rng.next);
      expect(pack.map((p) => p.slot)).toEqual([1, 2, 3, 4, 5]);
      for (const pull of pack.slice(0, 3)) expect(pull.rarity).toBe("common");
      expect(["common", "rare", "ultra"]).toContain(pack[3]!.rarity);
      const commons = pack.filter((p) => p.rarity === "common");
      expect(commons.length).toBeGreaterThanOrEqual(3);
      expect(new Set(commons.map((p) => p.key)).size).toBe(commons.length);
      for (const pull of pack) {
        expect(SET.find((c) => c.key === pull.key)?.rarity).toBe(pull.rarity);
        expect(NEXAMON_CONDITIONS).toContain(pull.condition);
      }
    }
  });

  it("is deterministic for a seed", () => {
    const a = createRng(7);
    const b = createRng(7);
    expect(nexamonOpenPack(SET, a.next)).toEqual(nexamonOpenPack(SET, b.next));
  });

  it("pulls at the stated rates over many packs (statistical, seeded)", () => {
    const rng = createRng(20261204);
    const packs = 360_000;
    const count: Record<NexamonRarity, number> = { common: 0, rare: 0, ultra: 0, prisma: 0, legendary: 0 };
    const perCard = new Map<string, number>();
    const conditions: Record<string, number> = {};
    for (let i = 0; i < packs; i++) {
      for (const pull of nexamonOpenPack(SET, rng.next)) {
        count[pull.rarity]++;
        perCard.set(pull.key, (perCard.get(pull.key) ?? 0) + 1);
        conditions[pull.condition] = (conditions[pull.condition] ?? 0) + 1;
      }
    }
    // within 5 standard deviations of a binomial count (legendary: n p = 400, sd 20)
    const near = (got: number, p: number, trials = packs) => {
      const sd = Math.sqrt(trials * p * (1 - p));
      expect(Math.abs(got - trials * p)).toBeLessThan(5 * sd);
    };
    near(count.legendary, 1 / 900);
    near(count.prisma, 1 / 80);
    // rare and ultra come from two independent slots with p/2 each
    near(count.ultra, 1 / 24, 2 * packs);
    near(count.rare, 1 / 4, 2 * packs);
    expect(count.common + count.rare + count.ultra + count.prisma + count.legendary).toBe(5 * packs);
    // every card of a rarity is equally likely
    for (const rarity of ["rare", "ultra", "prisma", "legendary"] as const) {
      const cards = SET.filter((c) => c.rarity === rarity);
      for (const card of cards) {
        const got = perCard.get(card.key) ?? 0;
        const mean = count[rarity] / cards.length;
        expect(Math.abs(got - mean), card.key).toBeLessThan(6 * Math.sqrt(mean) + 1);
      }
    }
    const total = 5 * packs;
    for (const condition of NEXAMON_CONDITIONS)
      near(conditions[condition] ?? 0, cfg.conditions.weightBps[condition] / 10_000, total);
  });

  it("refuses a set without the needed rarity", () => {
    expect(() =>
      nexamonOpenPack(
        SET.filter((c) => c.rarity !== "common"),
        () => 0.5,
      ),
    ).toThrow(RangeError);
  });
});

describe("Nexamon conditions and grading (ADR-165)", () => {
  it("rolls the four conditions with their weights; worse than good is very rare", () => {
    expect(NEXAMON_CONDITIONS).toEqual(["poor", "good", "near_mint", "mint"]);
    expect(Object.values(cfg.conditions.weightBps).reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(cfg.conditions.weightBps.poor).toBeLessThanOrEqual(300);
    expect(nexamonRollCondition(0)).toBe("poor");
    expect(nexamonRollCondition(0.0199)).toBe("poor");
    expect(nexamonRollCondition(0.02)).toBe("good");
    expect(nexamonRollCondition(0.1999)).toBe("good");
    expect(nexamonRollCondition(0.2)).toBe("near_mint");
    expect(nexamonRollCondition(0.6999)).toBe("near_mint");
    expect(nexamonRollCondition(0.7)).toBe("mint");
    expect(nexamonRollCondition(0.999999)).toBe("mint");
  });

  it("values a copy by condition: poor 70 %, good 90 %, near mint and mint full value", () => {
    expect(nexamonConditionBps("mint")).toBe(10_000);
    expect(nexamonConditionBps("near_mint")).toBe(10_000);
    expect(nexamonConditionBps("good")).toBe(9_000);
    expect(nexamonConditionBps("poor")).toBe(7_000);
    const value = nexamonE4FromCents(12_345);
    expect(nexamonCopyValueCents(value, "mint", null)).toBe(12_345);
    expect(nexamonCopyValueCents(value, "poor", null)).toBe(8_642); // 8 641.5 -> even
    expect(nexamonCopyValueCents(nexamonE4FromCents(10), "poor", null)).toBe(7);
    expect(nexamonCopyValueCents(nexamonE4FromCents(30), "poor", null)).toBe(21);
    expect(nexamonCopyValueCents(nexamonE4FromCents(15), "good", null)).toBe(14); // 13.5 -> even
    expect(nexamonCentsFromE4(150)).toBe(2);
    expect(nexamonCentsFromE4(250)).toBe(2);
  });

  it("has a full grade distribution per condition with half grades; a 10 is rare", () => {
    expect(cfg.grading.grades).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8.5, 9, 9.5, 10]);
    for (const condition of NEXAMON_CONDITIONS) {
      const weights = cfg.grading.gradeWeightsBps[condition];
      expect(weights).toHaveLength(12);
      expect(weights.reduce((a: number, b: number) => a + b, 0)).toBe(10_000);
    }
    // a 10 (without the Black Label): poor 0.05 %, good 0.5 %, near mint 2.5 %, mint 10 %
    expect(NEXAMON_CONDITIONS.map((c) => nexamonGradeChanceBps(c, 10))).toEqual([5, 50, 250, 1_000]);
    // stochastic dominance: for every grade g, P(grade >= g) grows with the condition
    const atLeast = (condition: NexamonCondition, i: number) =>
      cfg.grading.gradeWeightsBps[condition].slice(i).reduce((a: number, b: number) => a + b, 0);
    const eight = cfg.grading.grades.indexOf(8);
    for (let i = 1; i < 12; i++)
      for (let k = 1; k < NEXAMON_CONDITIONS.length; k++)
        if (i >= eight)
          expect(atLeast(NEXAMON_CONDITIONS[k]!, i)).toBeGreaterThan(atLeast(NEXAMON_CONDITIONS[k - 1]!, i));
        else expect(atLeast(NEXAMON_CONDITIONS[k]!, i)).toBeGreaterThanOrEqual(atLeast(NEXAMON_CONDITIONS[k - 1]!, i));
  });

  it("has exact odds per condition, half grades and Black Label included, summing to 10 000", () => {
    const black = NEXAMON_BLACK_LABEL_GRADE;
    const table = (c: NexamonCondition) =>
      [black, 10, 9.5, 9, 8.5, 8, 7, 6, 5, 4, 3, 2, 1].map((g) => nexamonGradeChanceBps(c, g));
    expect(table("mint")).toEqual([500, 1_000, 2_000, 3_000, 1_800, 1_200, 500, 0, 0, 0, 0, 0, 0]);
    expect(table("near_mint")).toEqual([100, 250, 950, 2_400, 2_400, 2_200, 1_200, 500, 0, 0, 0, 0, 0]);
    expect(table("good")).toEqual([0, 50, 200, 600, 1_000, 1_700, 2_500, 2_000, 1_200, 750, 0, 0, 0]);
    expect(table("poor")).toEqual([0, 5, 15, 30, 50, 200, 700, 1_500, 2_000, 2_000, 1_500, 1_200, 800]);
    for (const c of NEXAMON_CONDITIONS) expect(table(c).reduce((a, b) => a + b, 0)).toBe(10_000);
    // grades ASP never gives
    expect(nexamonGradeChanceBps("mint", 7.5)).toBe(0);
  });

  it("rolls grades from the distribution, every one of the 10 000 rolls counted", () => {
    expect(nexamonRollGrade("mint", 0)).toBe(7);
    expect(nexamonRollGrade("mint", 0.05)).toBe(8);
    expect(nexamonRollGrade("mint", 0.17)).toBe(8.5);
    expect(nexamonRollGrade("mint", 0.35)).toBe(9);
    expect(nexamonRollGrade("mint", 0.65)).toBe(9.5);
    expect(nexamonRollGrade("mint", 0.85)).toBe(10);
    expect(nexamonRollGrade("mint", 0.9499)).toBe(10);
    expect(nexamonRollGrade("mint", 0.95)).toBe(NEXAMON_BLACK_LABEL_GRADE);
    expect(nexamonRollGrade("near_mint", 0.99)).toBe(NEXAMON_BLACK_LABEL_GRADE);
    expect(nexamonRollGrade("near_mint", 0.9899)).toBe(10);
    expect(nexamonRollGrade("poor", 0)).toBe(1);
    expect(nexamonRollGrade("poor", 0.9999)).toBe(10);
    expect(nexamonRollGrade("good", 0.9999)).toBe(10);
    for (const condition of NEXAMON_CONDITIONS) {
      const counts = new Map<number, number>();
      for (let n = 0; n < 10_000; n++) {
        const g = nexamonRollGrade(condition, (n + 0.5) / 10_000);
        counts.set(g, (counts.get(g) ?? 0) + 1);
      }
      for (const g of [...cfg.grading.grades, NEXAMON_BLACK_LABEL_GRADE])
        expect(counts.get(g) ?? 0).toBe(nexamonGradeChanceBps(condition, g));
    }
  });

  it("gives the Black Label to 5 % of mint and 1 % of near mint gradings, never to good or poor", () => {
    const black = NEXAMON_BLACK_LABEL_GRADE;
    expect(black).toBe(11);
    expect(cfg.grading.blackLabel).toEqual({ chanceBps: { near_mint: 100, mint: 500 }, valueBps: 100_000 });
    expect(NEXAMON_CONDITIONS.map((c) => nexamonGradeChanceBps(c, black))).toEqual([0, 0, 100, 500]);
    // it never takes more than the chance for a 10
    const all = {
      ...cfg,
      grading: { ...cfg.grading, blackLabel: { chanceBps: { mint: 20_000 }, valueBps: 100_000 } },
    };
    expect(nexamonGradeChanceBps("mint", black, all as unknown as typeof cfg)).toBe(1_500);
    expect(nexamonGradeChanceBps("mint", 10, all as unknown as typeof cfg)).toBe(0);
    expect(nexamonRollGrade("mint", 0.86, all as unknown as typeof cfg)).toBe(black);
  });

  it("makes a Black Label worth ten times the card, a 10 four times, a 9.5 2.3 times", () => {
    const value = nexamonE4FromCents(100_000);
    expect(nexamonCopyFactorBps("mint", NEXAMON_BLACK_LABEL_GRADE)).toBe(100_000);
    expect(nexamonCopyValueCents(value, "mint", NEXAMON_BLACK_LABEL_GRADE)).toBe(1_000_000);
    expect(nexamonCopyValueCents(value, "mint", 10)).toBe(400_000);
    expect(nexamonCopyValueCents(value, "mint", 9.5)).toBe(230_000);
    expect(nexamonCopyValueCents(value, "mint", 8.5)).toBe(140_000);
    expect(nexamonIsBlackLabel(11)).toBe(true);
    expect(nexamonIsBlackLabel(10)).toBe(false);
    expect(nexamonIsBlackLabel(null)).toBe(false);
    expect(nexamonGradeNumber(11)).toBe(10);
    expect(nexamonGradeNumber(9.5)).toBe(9.5);
    expect(nexamonGradeNumber(7)).toBe(7);
    // a slab's price per card: a Black Label sold for 10x the value is a sale at the value
    expect(nexamonPricePerCardE4(1_000_000, nexamonCopyFactorBps("mint", NEXAMON_BLACK_LABEL_GRADE))).toBe(value);
    // no instant sale of a slab
    expect(nexamonQuickSellCents(1_000_000, "common", NEXAMON_BLACK_LABEL_GRADE)).toBeNull();
  });

  it("keeps grading a gamble: expected factors per condition against the 40 % fee", () => {
    expect(cfg.grading.feeBps).toBe(4_000);
    const fee = (c: NexamonCondition) => (cfg.grading.feeBps * nexamonConditionBps(c)) / 10_000;
    expect(nexamonExpectedGradeFactorBps("mint")).toBe(23_110);
    expect(nexamonExpectedGradeFactorBps("near_mint")).toBe(15_745);
    expect(nexamonExpectedGradeFactorBps("good")).toBe(10_260);
    expect(nexamonExpectedGradeFactorBps("poor")).toBeCloseTo(6_315.5, 5);
    // after the fee good and poor lose on average, near mint and mint win on average
    for (const c of ["poor", "good"] as const)
      expect(nexamonExpectedGradeFactorBps(c) - fee(c)).toBeLessThan(nexamonConditionBps(c));
    for (const c of ["near_mint", "mint"] as const)
      expect(nexamonExpectedGradeFactorBps(c) - fee(c)).toBeGreaterThan(nexamonConditionBps(c));
    // but a mint copy still loses money in 17 % of the gradings (an 8 or a 7)
    const losing = cfg.grading.grades
      .filter((g) => nexamonCopyFactorBps("mint", g) - fee("mint") < 10_000)
      .reduce((sum, g) => sum + nexamonGradeChanceBps("mint", g), 0);
    expect(losing).toBe(1_700);
  });

  it("makes grades 8 to 10 always worth more than the raw card, lower grades less", () => {
    const mult = cfg.grading.valueBps;
    expect(mult).toHaveLength(12);
    for (let i = 1; i < 12; i++) expect(mult[i]!).toBeGreaterThan(mult[i - 1]!);
    for (const g of [8, 8.5, 9, 9.5, 10]) expect(nexamonCopyFactorBps("mint", g)).toBeGreaterThan(10_000);
    for (const g of [1, 2, 3, 4, 5, 6, 7])
      expect(nexamonCopyFactorBps("mint", g)).toBeLessThan(nexamonConditionBps("mint"));
    expect(nexamonCopyFactorBps("poor", 10)).toBe(40_000);
    const value = nexamonE4FromCents(100_000);
    expect(nexamonCopyValueCents(value, "poor", 10)).toBe(400_000);
    expect(nexamonCopyValueCents(value, "good", 9)).toBe(170_000);
    expect(nexamonCopyValueCents(value, "good", 8)).toBe(120_000);
    expect(nexamonCopyValueCents(value, "mint", 7)).toBe(90_000);
  });

  it("charges 40 % of the copy's value for grading, at least the minimum", () => {
    expect(nexamonGradingFeeCents(100_000)).toBe(40_000);
    expect(nexamonGradingFeeCents(95)).toBe(100);
    expect(nexamonGradingFeeCents(1_005)).toBe(402);
    expect(cfg.grading.minutes).toBe(60);
  });
});

describe("Nexamon market value (ADR-165)", () => {
  const start = nexamonE4FromCents(1_000_000);
  const sale = (over: Partial<NexamonSaleInput> = {}): NexamonSaleInput => ({
    valueE4: start,
    priceCents: 1_100_000,
    factorBps: 10_000,
    rarity: "prisma",
    population: 3,
    pairSales: 0,
    buyerSalesToday: 0,
    ...over,
  });

  it("finds rare cards with a low population popular", () => {
    const pops = NEXAMON_RARITIES.map((r) => nexamonPopularityBps(r, 10));
    for (let i = 1; i < pops.length; i++) expect(pops[i]!).toBeGreaterThan(pops[i - 1]!);
    expect(nexamonPopularityBps("legendary", 1)).toBe(10_000);
    expect(nexamonPopularityBps("legendary", 1_000)).toBeLessThan(9_100);
    expect(nexamonPopularityBps("prisma", 2)).toBeGreaterThan(nexamonPopularityBps("prisma", 200));
    expect(nexamonPopularityBps("common", 6)).toBeLessThan(3_600);
    const above = (rarity: NexamonRarity, population: number) =>
      nexamonAiBuyChanceBps({
        priceCents: 10_001,
        copyValueCents: 10_000,
        condition: "mint",
        grade: null,
        rarity,
        population,
      });
    expect(above("legendary", 1)).toBeCloseTo(2 * cfg.ai.buyChanceBps, -1);
    expect(above("common", 100_000)).toBeLessThan(above("ultra", 10));
  });

  it("removes the condition or grade factor from a sale price", () => {
    expect(nexamonPricePerCardE4(300_000, 30_000)).toBe(nexamonE4FromCents(100_000));
    expect(nexamonPricePerCardE4(9_500, 9_500)).toBe(nexamonE4FromCents(10_000));
  });

  it("ignores absurd prices: only sales within 25 % of the value count", () => {
    expect(nexamonPriceIsPlausible(start * 1.25, start)).toBe(true);
    expect(nexamonPriceIsPlausible(start * 1.2501, start)).toBe(false);
    expect(nexamonPriceIsPlausible(start * 0.75, start)).toBe(true);
    expect(nexamonPriceIsPlausible(start * 0.7499, start)).toBe(false);
    expect(nexamonValueAfterSale(sale({ priceCents: 100_000_000 }))).toBe(start);
    expect(nexamonValueAfterSale(sale({ priceCents: 1 }))).toBe(start);
  });

  it("follows a sale part of the way, at most 2 %, upward scaled by popularity", () => {
    const pop = nexamonPopularityBps("prisma", 3);
    // 10 % above: 20 % of the way = 2 % = the cap
    expect(nexamonValueAfterSale(sale())).toBe(start + Math.floor((start * 0.02 * pop) / 10_000));
    // 25 % above is capped at the same step
    expect(nexamonValueAfterSale(sale({ priceCents: 1_250_000 }))).toBe(nexamonValueAfterSale(sale()));
    // 5 % above: 1 %
    expect(nexamonValueAfterSale(sale({ priceCents: 1_050_000 }))).toBe(
      start + Math.floor((start * 0.01 * pop) / 10_000),
    );
    // below the value: down, not scaled by popularity
    expect(nexamonValueAfterSale(sale({ priceCents: 950_000 }))).toBe(start - start * 0.01);
    expect(nexamonValueAfterSale(sale({ priceCents: 800_000 }))).toBe(start - start * 0.02);
    // an unpopular common moves up only a quarter as far
    const common = nexamonValueAfterSale(sale({ rarity: "common", population: 5_000 }));
    expect(common - start).toBe(Math.floor((start * 0.02 * cfg.value.trade.minPopularityBps) / 10_000));
    // a slab sold for 3x counts at its price per card
    expect(nexamonValueAfterSale(sale({ priceCents: 3_300_000, factorBps: 30_000 }))).toBe(
      nexamonValueAfterSale(sale()),
    );
  });

  it("does not let two friends set the value by trading back and forth", () => {
    expect(nexamonSaleCounts(sale())).toBe(true);
    expect(nexamonSaleCounts(sale({ pairSales: 1 }))).toBe(false);
    expect(nexamonSaleCounts(sale({ buyerSalesToday: cfg.value.trade.perPlayerDay }))).toBe(false);
    expect(nexamonValueAfterSale(sale({ pairSales: 1 }))).toBe(start);
    // 30 wash trades in a day at the top of the band: only the first counts, the rest change nothing
    let value = start;
    for (let i = 0; i < 30; i++)
      value = nexamonValueAfterSale(sale({ valueE4: value, priceCents: 1_250_000, pairSales: i === 0 ? 0 : 1 }));
    expect(value).toBeLessThanOrEqual(Math.round(start * 1.02));
    // and a jump beyond the band is no trade at all
    expect(nexamonValueAfterSale(sale({ priceCents: 5_000_000 }))).toBe(start);
  });

  it("keeps the value between floor and cap and inside the day's corridor", () => {
    const bounds = nexamonValueBounds({ startE4: start, ageDays: 0, countedTrades: 0, dayRefE4: start });
    expect(bounds).toEqual({
      floorE4: start * 0.2,
      capE4: start * 3,
      dayLowE4: start * 0.8,
      dayHighE4: Math.round(start * 1.15),
    });
    expect(nexamonCapBps(0, 0)).toBe(30_000);
    expect(nexamonCapBps(10, 4)).toBe(30_000 + 2_000 + 200);
    expect(nexamonCapBps(100_000, 0)).toBe(cfg.value.capMaxBps);
    const b = { startE4: start, ageDays: 0, countedTrades: 0, dayRefE4: start };
    expect(nexamonClampValue(start * 2, b)).toBe(Math.round(start * 1.15));
    expect(nexamonClampValue(start * 0.1, b)).toBe(start * 0.8);
    expect(nexamonClampValue(start * 1.1, b)).toBe(start * 1.1);
    // floor and cap win over the day's corridor
    expect(nexamonClampValue(start * 5, { ...b, dayRefE4: start * 2.9 })).toBe(start * 3);
    expect(nexamonClampValue(1, { ...b, dayRefE4: start * 0.21 })).toBe(start * 0.2);
    // driving it up every day ends at the cap, which only grows slowly
    let value = start;
    for (let day = 0; day < 400; day++)
      value = nexamonClampValue(value * 2, { startE4: start, ageDays: day, countedTrades: day, dayRefE4: value });
    expect(value).toBeLessThanOrEqual((start * cfg.value.capMaxBps) / 10_000);
    expect(value).toBeGreaterThan(start * 3);
  });

  it("starts in balance: what the AI offers at the start equals the demand", () => {
    for (const rarity of ["common", "rare", "ultra", "prisma"] as const) {
      const input = {
        rarity,
        population: cfg.ai.seedCopies[rarity],
        supply: cfg.ai.listedPerCard[rarity],
        recentBuys: 0,
      };
      expect(nexamonDemandMilli(rarity, input.population, 0)).toBe(1_000 * cfg.value.pressure.want[rarity]);
      expect(nexamonPressureBps(input)).toBe(0);
      expect(nexamonValueAfterPressure(start, input)).toBe(start);
    }
    expect(nexamonPressureBps({ rarity: "legendary", population: 0, supply: 0, recentBuys: 0 })).toBe(0);
  });

  it("rises when a popular card is bought up and hoarded, falls when it is dumped", () => {
    // 12 prismas exist, a player holds 10 and nothing is on offer
    const hoarded = { rarity: "prisma", population: 12, supply: 0, recentBuys: 2 } as const;
    expect(nexamonPressureBps(hoarded)).toBeGreaterThan(5_000);
    expect(nexamonValueAfterPressure(start, hoarded)).toBeGreaterThan(start);
    // the same for a common barely moves: it is not popular
    const common = { rarity: "common", population: 12, supply: 0, recentBuys: 2 } as const;
    const upPrisma = nexamonValueAfterPressure(start, hoarded) - start;
    const upCommon = nexamonValueAfterPressure(start, common) - start;
    expect(upCommon).toBeGreaterThan(0);
    expect(upCommon * 2).toBeLessThan(upPrisma);
    // dumping: many copies on offer push any card down
    const dumped = { rarity: "prisma", population: 12, supply: 6, recentBuys: 0 } as const;
    expect(nexamonPressureBps(dumped)).toBe(-10_000);
    expect(nexamonValueAfterPressure(start, dumped)).toBe(start - (start * cfg.value.pressure.downStepBps) / 10_000);
    // a growing population lowers the demand
    expect(nexamonDemandMilli("prisma", 100, 0)).toBeLessThan(nexamonDemandMilli("prisma", 5, 0));
    expect(nexamonDemandMilli("prisma", 5, 99)).toBe(
      nexamonDemandMilli("prisma", 5, 0) + cfg.value.pressure.buyWeightMilli * cfg.value.pressure.maxBuys,
    );
  });

  it("lets the first legendary rise only slowly and less as more are pulled", () => {
    const one = { rarity: "legendary", population: 1, supply: 0, recentBuys: 0 } as const;
    const perHour = nexamonValueAfterPressure(start, one) / start - 1;
    expect(perHour).toBeGreaterThan(0);
    expect(perHour).toBeLessThan(0.004);
    const ten = { ...one, population: 10 };
    expect(nexamonPressureBps(ten)).toBeLessThan(nexamonPressureBps(one) / 2);
    // once the AI offers one, the pressure turns
    expect(nexamonPressureBps({ ...ten, supply: 1 })).toBeLessThan(0);
  });

  it("moves up a little when an AI collector buys, down a little per instant sale", () => {
    const up = nexamonValueAfterAiBuy(start, "legendary", 1);
    expect(up).toBe(start + (start * cfg.value.aiBuyBumpBps) / 10_000);
    expect(nexamonValueAfterAiBuy(start, "common", 5_000) - start).toBeLessThan((up - start) / 5);
    expect(nexamonValueAfterQuickSell(start)).toBe(start - (start * cfg.quickSell.dropBps) / 10_000);
  });
});

describe("Nexamon AI and fees (ADR-165)", () => {
  it("asks 10 % above the value; AI collectors always buy at or below the value, above it by condition", () => {
    expect(nexamonAiAskCents(10_000)).toBe(11_000);
    expect(nexamonAiAskCents(5)).toBe(cfg.market.minPriceCents);
    const chance = (priceCents: number, condition: NexamonCondition, grade: number | null, copyValueCents = 10_000) =>
      nexamonAiBuyChanceBps({ priceCents, copyValueCents, condition, grade, rarity: "common", population: 1_000_000 });
    // at or below the value: certain, raw or slab
    expect(chance(10_000, "poor", null)).toBe(10_000);
    expect(chance(1, "good", null)).toBe(10_000);
    expect(chance(40_000, "mint", 10, 40_000)).toBe(10_000);
    expect(chance(0, "mint", null)).toBe(0);
    // premiums: poor 0 %, good 3 %, near mint 8 %, mint 12 %; slabs by grade, Black Label 20 %
    expect(["poor", "good", "near_mint", "mint"].map((c) => nexamonAiPremiumBps(c as NexamonCondition, null))).toEqual([
      0, 300, 800, 1_200,
    ]);
    expect([7, 8, 8.5, 9, 9.5, 10, 11].map((g) => nexamonAiPremiumBps("mint", g))).toEqual([
      0, 500, 700, 1_000, 1_200, 1_500, 2_000,
    ]);
    expect(nexamonAiMaxPriceCents(10_000, "mint", null)).toBe(11_200);
    expect(nexamonAiMaxPriceCents(10_000, "near_mint", null)).toBe(10_800);
    expect(chance(10_001, "poor", null)).toBe(0);
    expect(chance(11_200, "mint", null)).toBeGreaterThan(0);
    expect(chance(11_201, "mint", null)).toBe(0);
    expect(chance(10_800, "near_mint", null)).toBeGreaterThan(0);
    expect(chance(10_801, "near_mint", null)).toBe(0);
    // falling from the full chance just above the value to atMaxChanceBps of it at the maximum
    const full = chance(10_001, "mint", null);
    expect(chance(10_600, "mint", null)).toBeLessThan(full);
    expect(chance(11_200, "mint", null)).toBeCloseTo((full * cfg.ai.atMaxChanceBps) / 10_000, -1);
    expect(nexamonAiExpectedMinutes(10_000)).toBe(1);
    expect(nexamonAiExpectedMinutes(3_000)).toBe(3);
    expect(nexamonAiExpectedMinutes(0)).toBeNull();
  });

  it("lets an AI buy move the value only at a plausible price and a few times per card and window", () => {
    const valueE4 = nexamonE4FromCents(10_000);
    const base = { priceCents: 10_000, factorBps: 10_000, valueE4, rarity: "common" as const, countedInWindow: 0 };
    expect(nexamonAiBuyCounts(base)).toBe(true);
    // far below the value (outside the band): sells, but does not count
    expect(nexamonAiBuyCounts({ ...base, priceCents: 7_000 })).toBe(false);
    expect(nexamonAiBuyCounts({ ...base, priceCents: 7_500 })).toBe(true);
    expect(nexamonAiBuyCounts({ ...base, countedInWindow: cfg.ai.buysPerCardWindow.common })).toBe(false);
    // a mint premium stays inside the band
    expect(nexamonAiBuyCounts({ ...base, priceCents: 11_200 })).toBe(true);
  });

  it("seeds no legendary and only the cheapest prismas", () => {
    expect(nexamonSeedCopies("legendary", 0)).toBe(0);
    expect(nexamonSeedCopies("prisma", 0)).toBe(1);
    expect(nexamonSeedCopies("prisma", 1)).toBe(1);
    expect(nexamonSeedCopies("prisma", 2)).toBe(0);
    expect(nexamonSeedCopies("common", 49)).toBe(6);
    expect(cfg.ai.listedPerCard.legendary).toBe(0);
    for (const rarity of ["common", "rare", "ultra", "prisma"] as const)
      expect(cfg.ai.listedPerCard[rarity]).toBeLessThanOrEqual(cfg.ai.seedCopies[rarity]);
  });

  it("takes 5 % from a selling player and pays half the value for bulk", () => {
    expect(nexamonMarketFeeCents(10_000)).toBe(500);
    expect(nexamonMarketFeeCents(19)).toBe(0);
    expect(nexamonQuickSellCents(1_001, "common", null)).toBe(500);
    expect(nexamonQuickSellCents(1_000, "rare", null)).toBe(500);
    expect(nexamonQuickSellCents(1_000, "ultra", null)).toBeNull();
    expect(nexamonQuickSellCents(1_000, "common", 9)).toBeNull();
  });

  it("has the three sets with their pack prices", () => {
    expect(cfg.packSize).toBe(5);
    expect(cfg.sets.mystic_energy).toEqual({ name: "Nexamon: Mystic Energy", packPriceCents: 20_000 });
    expect(cfg.sets.super_apex).toEqual({ name: "Nexamon: Super Apex", packPriceCents: 100_000 });
    expect(cfg.sets.prismatic_peak).toEqual({ name: "Nexamon: Prismatic Peak", packPriceCents: 1_000_000 });
    expect(BALANCE.progression.unlocks.find((u) => u.key === "nexamon")?.level).toBe(10);
  });
});
