import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { LISTED_ITEMS, OPERATING_CATEGORIES } from "../../config/listed.ts";
import {
  advisorWageCents,
  progressiveTaxCents,
  aiFloatVote,
  aiWorkerQuits,
  boardDecided,
  boardOutcome,
  booksDiscountBps,
  booksStage,
  booksTax,
  canConvene,
  canStartItem,
  dividendSplit,
  estimateTax,
  gradeReceipts,
  greedShare,
  isOperating,
  itemByKey,
  itemCostCents,
  itemUpkeepCents,
  lateFeeCents,
  latePaymentCents,
  layoffHeatNext,
  listedHourEffect,
  maxDividendCents,
  missingRequirements,
  NEUTRAL_HOUR_EFFECT,
  payoutRatioBps,
  pickReceipts,
  refRevenueCents,
  reputationEffect,
  reputationTarget,
  satisfactionEffect,
  satisfactionTarget,
  satisfactionZone,
  stepToward,
  sumEffects,
  taxRateBps,
  type OwnedItem,
} from "./listed.ts";
import { closeStartupHour, type StartupHourInput, type StartupState } from "./startup.ts";

const item = (key: string) => itemByKey(key)!;
const active = (key: string, level = 1): OwnedItem => ({ key, status: "active", level });

/*
 * The numbers marked "SQL" are asserted with the same inputs in supabase/tests/a3_listed_company.sql: the database
 * runs the same formulas.
 */
describe("listed companies: the catalogue (ADR-167)", () => {
  it("has many levers, unique keys, known requirements and no cycles", () => {
    expect(LISTED_ITEMS.length).toBeGreaterThanOrEqual(60);
    const keys = new Set(LISTED_ITEMS.map((i) => i.key));
    expect(keys.size).toBe(LISTED_ITEMS.length);
    for (const i of LISTED_ITEMS) {
      expect(i.key).toMatch(/^[a-z0-9_]+$/);
      for (const need of i.requires ?? []) expect(keys.has(need), `${i.key} needs ${need}`).toBe(true);
    }
    // every item can be reached by buying things in some order
    const owned: OwnedItem[] = [];
    for (let round = 0; round < 12; round++) {
      for (const i of LISTED_ITEMS) {
        if (owned.some((o) => o.key === i.key)) continue;
        if (missingRequirements(i, owned).length === 0) owned.push(active(i.key));
      }
    }
    expect(owned.length).toBe(LISTED_ITEMS.length);
    expect(new Set(LISTED_ITEMS.map((i) => i.kind)).size).toBe(8);
    expect(LISTED_ITEMS.filter((i) => i.kind === "research")).toHaveLength(28);
    expect(LISTED_ITEMS.filter((i) => i.kind === "benefit").length).toBeGreaterThanOrEqual(12);
  });

  it("research gets expensive at the top, benefits cost per head", () => {
    const tiers = [1, 2, 3, 4].map((t) => itemCostCents(item(`r_quality_${t}`), 0, 500_000, 10));
    expect(tiers).toEqual([3_000_000, 9_000_000, 24_000_000, 60_000_000]);
    for (const i of LISTED_ITEMS.filter((x) => x.kind === "benefit")) {
      expect(i.upkeepPerHeadCents, i.key).toBeGreaterThan(0);
      expect(i.effects.satisfaction, i.key).toBeGreaterThan(0);
    }
  });

  it("prices follow the size of the company (SQL)", () => {
    expect(refRevenueCents([])).toBe(20_000);
    expect(refRevenueCents([100_000, 200_001])).toBe(150_001);
    expect(refRevenueCents(Array<number>(30).fill(1_000).concat(Array<number>(24).fill(90_000)))).toBe(90_000);
    expect(itemCostCents(item("r_quality_3"), 0, 100_000, 3)).toBe(4_800_000);
    expect(itemCostCents(item("r_quality_3"), 0, 20_000, 3)).toBe(2_500_000);
    expect(itemCostCents(item("m_machines"), 2, 35_000, 3)).toBe(896_000);
    expect(itemCostCents(item("x_teamevent"), 0, 35_000, 7)).toBe(72_000);
    expect(itemCostCents(item("x_teamevent"), 0, 35_000, 0)).toBe(36_000);
    expect(itemUpkeepCents(item("p_premium"), 1, 123_456, 5)).toBe(3_704);
    expect(itemUpkeepCents(item("m_machines"), 3, 123_456, 5)).toBe(1_851);
    expect(itemUpkeepCents(item("b_obstkorb"), 1, 123_456, 20)).toBe(800);
    expect(itemUpkeepCents(item("r_quality_1"), 1, 123_456, 20)).toBe(0);
  });

  it("requirements, levels and re-buying", () => {
    expect(missingRequirements(item("r_quality_2"), [])).toEqual(["r_quality_1"]);
    expect(missingRequirements(item("r_quality_2"), [{ key: "r_quality_1", status: "running", level: 0 }])).toEqual([
      "r_quality_1",
    ]);
    expect(missingRequirements(item("r_quality_2"), [active("r_quality_1")])).toEqual([]);
    expect(missingRequirements(item("r_quality_4"), [active("r_quality_3")])).toEqual(["r_efficiency_2"]);
    expect(canStartItem(item("m_machines"), [active("m_machines", 4)])).toBe(true);
    expect(canStartItem(item("m_machines"), [active("m_machines", 5)])).toBe(false);
    expect(canStartItem(item("p_second"), [{ key: "p_second", status: "retired", level: 0 }])).toBe(true);
    expect(canStartItem(item("p_second"), [{ key: "p_second", status: "running", level: 0 }])).toBe(false);
    expect(canStartItem(item("x_pizza"), [active("x_pizza", 0)])).toBe(true);
  });

  it("only active items have an effect, levels multiply", () => {
    const fx = sumEffects([
      active("r_quality_1"),
      active("m_machines", 3),
      { key: "p_second", status: "paused", level: 1 },
      { key: "r_brand_1", status: "running", level: 0 },
      active("b_obstkorb"),
      active("b_viertagewoche"),
    ]);
    expect(fx).toEqual({
      demandBps: 0,
      marketBps: 0,
      capacityBps: 1_200 - 600,
      qualityBps: 300,
      awarenessBps: 0,
      marginBps: 0,
      fixedCostBps: 0,
      taxRateBps: 0,
      satisfaction: 13,
      reputation: 0,
    });
  });
});

describe("listed companies: employee satisfaction", () => {
  const calm = {
    benefitPoints: 0,
    payFactorBps: 10_000,
    payMoodBps: 10_000,
    utilization: 0.7,
    crisisSeverity: 0,
    scandal: false,
    layoffHeat: 0,
    payoutRatioBps: 0,
    profitCents: 0,
  };

  it("without spending the target is the base, below the green zone", () => {
    const t = satisfactionTarget(calm);
    expect(t.target).toBe(50);
    expect(satisfactionZone(t.target)).toBe("yellow");
    // a profitable hour and three cheap benefits reach the green zone
    expect(satisfactionTarget({ ...calm, benefitPoints: 11, profitCents: 1 }).target).toBe(64);
  });

  it("every driver moves it (SQL)", () => {
    const t = satisfactionTarget({
      benefitPoints: 11,
      payFactorBps: 9_000,
      payMoodBps: 10_000,
      utilization: 1.2,
      crisisSeverity: 2,
      scandal: true,
      layoffHeat: 6,
      payoutRatioBps: 6_500,
      profitCents: 1_000,
    });
    expect(t.drivers.base).toBe(50);
    expect(t.drivers.benefits).toBe(11);
    expect(t.drivers.wages).toBeCloseTo(-2.5, 9);
    expect(t.drivers.workload).toBeCloseTo(-5.454545, 5);
    expect(t.drivers.crisis).toBe(-14);
    expect(t.drivers.layoffs).toBe(-6);
    expect(t.drivers.greed).toBeCloseTo(-5, 9);
    expect(t.drivers.success).toBe(3);
    expect(t.target).toBeCloseTo(31.045455, 5);
  });

  it("benefits are capped, idling and losses hurt, the target stays in 0..100", () => {
    expect(satisfactionTarget({ ...calm, benefitPoints: 99 }).drivers.benefits).toBe(40);
    expect(satisfactionTarget({ ...calm, utilization: 0.2 }).drivers.workload).toBe(-4);
    expect(satisfactionTarget({ ...calm, utilization: 3 }).drivers.workload).toBe(-12);
    expect(satisfactionTarget({ ...calm, profitCents: -5 }).drivers.success).toBe(-3);
    expect(
      satisfactionTarget({ ...calm, payFactorBps: 0, payMoodBps: 0, layoffHeat: 99, crisisSeverity: 3 }).target,
    ).toBe(0);
  });

  it("drifts toward the target, 15 % of the gap per hour", () => {
    expect(stepToward(55, 50, 0.15)).toBeCloseTo(54.25, 9);
    let v = 80;
    for (let i = 0; i < 24; i++) v = stepToward(v, 50, BALANCE.listed.satisfaction.adjustPerHour);
    expect(v).toBeLessThan(51);
    expect(stepToward(99, 500, 0.5)).toBe(100);
  });

  it("below the green zone capacity and quality fall, above there is a small bonus (SQL)", () => {
    expect(satisfactionEffect(60)).toEqual({ capacityFactor: 1, qualityAdd: 0 });
    expect(satisfactionEffect(90).capacityFactor).toBeCloseTo(1.06, 9);
    expect(satisfactionEffect(100).capacityFactor).toBeCloseTo(1.06, 9);
    const low = satisfactionEffect(45);
    expect(low.capacityFactor).toBeCloseTo(0.925, 9);
    expect(low.qualityAdd).toBeCloseTo(-0.0375, 9);
    expect(satisfactionEffect(0).capacityFactor).toBeCloseTo(0.7, 9);
    expect(satisfactionZone(60)).toBe("green");
    expect(satisfactionZone(35)).toBe("yellow");
    expect(satisfactionZone(34.9)).toBe("red");
  });

  it("dismissals heat up and fade, AI workers quit every third hour in the red", () => {
    expect(layoffHeatNext(0, 2)).toBe(6);
    expect(layoffHeatNext(6, 0)).toBeCloseTo(5.52, 9);
    expect([1, 2, 3, 4, 5, 6].map((h) => aiWorkerQuits(h, 2))).toEqual([false, false, true, false, false, true]);
    expect(aiWorkerQuits(3, 0)).toBe(false);
    expect(aiWorkerQuits(0, 5)).toBe(false);
  });
});

describe("listed companies: reputation", () => {
  it("payouts are measured against the profit, with a floor on the revenue (SQL)", () => {
    expect(payoutRatioBps(0, 100, 100)).toBe(0);
    expect(payoutRatioBps(60_000, 100_000, 500_000)).toBe(6_000);
    expect(payoutRatioBps(60_000, -5, 500_000)).toBe(24_000);
    expect(greedShare(3_000)).toBe(0);
    expect(greedShare(6_500)).toBeCloseTo(0.5, 9);
    expect(greedShare(20_000)).toBe(1);
  });

  it("greed lowers it, reinvesting and dividends raise it (SQL)", () => {
    const t = reputationTarget({
      itemPoints: 5,
      payoutCents: 60_000,
      profitCents: 100_000,
      revenueCents: 500_000,
      investedCents: 20_000,
      dividendCents: 10_000,
      dividendStreak: 2,
      scandal: false,
    });
    expect(t.payoutRatioBps).toBe(6_000);
    expect(t.drivers.greed).toBeCloseTo(-15, 9);
    expect(t.drivers.reinvest).toBeCloseTo(4.8, 9);
    expect(t.drivers.dividends).toBeCloseTo(8, 9);
    expect(t.target).toBeCloseTo(52.8, 9);
  });

  it("a founder who takes everything loses customers, a generous one wins them", () => {
    const base = { itemPoints: 0, profitCents: 100_000, revenueCents: 500_000, dividendStreak: 0, scandal: false };
    const greedy = reputationTarget({ ...base, payoutCents: 100_000, investedCents: 0, dividendCents: 0 });
    expect(greedy.target).toBe(15);
    expect(reputationEffect(greedy.target).demandFactor).toBeCloseTo(0.86, 9);
    const half = reputationTarget({ ...base, payoutCents: 50_000, investedCents: 0, dividendCents: 0 });
    expect(half.target).toBeCloseTo(40, 9);
    const generous = reputationTarget({
      ...base,
      payoutCents: 20_000,
      investedCents: 50_000,
      dividendCents: 20_000,
      dividendStreak: 6,
    });
    expect(generous.target).toBe(80);
    expect(reputationEffect(generous.target).demandFactor).toBeCloseTo(1.12, 9);
    expect(reputationEffect(generous.target).priceFactor).toBeCloseTo(1.15, 9);
    expect(reputationEffect(50)).toEqual({ demandFactor: 1, priceFactor: 1 });
    expect(
      reputationTarget({ ...base, payoutCents: 0, investedCents: 0, dividendCents: 0, scandal: true }).target,
    ).toBe(45);
  });
});

describe("listed companies: the operating hour", () => {
  const fx = {
    ...sumEffects([]),
    demandBps: 800,
    marketBps: 1_000,
    capacityBps: 500,
    qualityBps: 300,
    awarenessBps: 200,
    marginBps: 200,
    fixedCostBps: -500,
  };

  it("items, mood and reputation become the terms of the hour (SQL)", () => {
    const e = listedHourEffect(fx, 45, 40);
    expect(e.awarenessAdd).toBeCloseTo(0.02, 9);
    expect(e.qualityAdd).toBeCloseTo(-0.0075, 9);
    expect(e.demandFactor).toBeCloseTo(1.14048, 9);
    expect(e.capacityFactor).toBeCloseTo(0.97125, 9);
    expect(e.cogsFactor).toBeCloseTo(0.98, 9);
    expect(e.fixedFactor).toBeCloseTo(0.95, 9);
    expect(listedHourEffect(sumEffects([]), 60, 50)).toEqual(NEUTRAL_HOUR_EFFECT);
    // the effects cannot make goods or fixed costs free
    expect(listedHourEffect({ ...fx, marginBps: 9_000, fixedCostBps: -9_000 }, 60, 50).cogsFactor).toBe(0.5);
    expect(listedHourEffect({ ...fx, marginBps: 9_000, fixedCostBps: -9_000 }, 60, 50).fixedFactor).toBe(0.5);
  });

  const state: StartupState = {
    potentialAnnualCents: 30_000_000,
    awareness: 0.5,
    quality: 0.5,
    quartersActive: 3,
    cashCents: BigInt(0),
  };
  const input: StartupHourInput = {
    sector: "tech",
    tier: "ag",
    marketingCentsPerQuarter: BigInt(0),
    productivityBps: [15_000],
    aiWorkers: 0,
    stage: 0,
    noise: 0,
    playerWagesCents: 0,
    priceLevel: "normal",
    contractWork: false,
    expansionLevel: 0,
  };

  it("a private company and a neutral listed company close the same hour", () => {
    const plain = closeStartupHour(state, input);
    const neutral = closeStartupHour(state, { ...input, listed: { ...NEUTRAL_HOUR_EFFECT, costsCents: 0 } });
    expect(neutral).toEqual(plain);
    expect(plain.listedCostsCents).toBe(BigInt(0));
  });

  it("the listed terms change demand, capacity, goods and fixed costs; running costs count as fixed costs (SQL)", () => {
    // the scale before ADR-180 (market x 40 for an AG, 300 000 per productivity), so the numbers below stay readable
    const old = {
      ...BALANCE,
      startups: {
        ...BALANCE.startups,
        marketFactorByTier: { ...BALANCE.startups.marketFactorByTier, ag: 40 },
        capacityCentsPerProductivity: { ...BALANCE.startups.capacityCentsPerProductivity, tech: 300_000 },
      },
    };
    const plain = closeStartupHour(state, input, old);
    const e = listedHourEffect(fx, 45, 40);
    // running costs: a second product (1.5 %) and a region (2 %) of 750 € reference revenue
    const costs = itemUpkeepCents(item("p_second"), 1, 75_000, 1) + itemUpkeepCents(item("g_south"), 1, 75_000, 1);
    expect(costs).toBe(2_625);
    const r = closeStartupHour(state, { ...input, listed: { ...e, costsCents: costs } }, old);
    // demand: potential x 40 (AG) / 4 / 6 x awareness 0.52 x (0.5 + 0.5 x 0.4925) x 1.14048
    expect(Number(plain.demandCents)).toBe(18_750_000);
    expect(Number(r.demandCents)).toBe(Math.round(50_000_000 * 0.52 * (0.5 + 0.5 * 0.4925) * 1.14048));
    expect(Number(r.demandCents)).toBe(22_128_163);
    // capacity: 1.5 x 300 000 / 6 x 0.97125
    expect(Number(plain.capacityCents)).toBe(75_000);
    expect(Number(r.capacityCents)).toBe(72_844);
    expect(Number(r.revenueCents)).toBe(72_844);
    // goods: sold x (1 - 0.75) x 0.98
    expect(Number(r.cogsCents)).toBe(17_847);
    // fixed: round(1 000 000 / 6) x 0.95, plus the running costs
    expect(Number(plain.fixedCents)).toBe(166_667);
    expect(Number(r.fixedCents)).toBe(158_334 + 2_625);
    expect(r.listedCostsCents).toBe(BigInt(2_625));
    expect(Number(r.profitCents)).toBe(72_844 - 17_847 - 160_959);
  });

  it("premium needs quality: a bad mood can push the quality under the line", () => {
    const premium = { ...input, priceLevel: "premium" as const };
    const ok = closeStartupHour(state, { ...premium, listed: { ...NEUTRAL_HOUR_EFFECT, costsCents: 0 } });
    const sad = closeStartupHour(state, {
      ...premium,
      listed: { ...NEUTRAL_HOUR_EFFECT, qualityAdd: satisfactionEffect(40).qualityAdd, costsCents: 0 },
    });
    expect(Number(sad.demandCents)).toBeLessThan(Number(ok.demandCents) * 0.6);
  });
});

describe("listed companies: dividends and the board", () => {
  it("a dividend is split by shares, the AI float gets the rest (SQL)", () => {
    const split = dividendSplit(100_000, 1_000_000_000_000, [600_000_000_000, 250_000_000_000, 100_000_000_000]);
    expect(split).toEqual({ players: [60_000, 25_000, 10_000], floatCents: 5_000 });
    const odd = dividendSplit(100, 3_000_000, [1_000_000, 1_000_000]);
    expect(odd).toEqual({ players: [33, 33], floatCents: 34 });
    expect(odd.players.reduce((a, b) => a + b, 0) + odd.floatCents).toBe(100);
    expect(maxDividendCents(1_000_001)).toBe(500_000);
    expect(maxDividendCents(-5)).toBe(0);
  });

  it("more than 20 % of the shares convene the board", () => {
    expect(canConvene(200_000_000_000, 1_000_000_000_000)).toBe(false);
    expect(canConvene(200_000_000_001, 1_000_000_000_000)).toBe(true);
    expect(canConvene(1, 0)).toBe(false);
  });

  it("votes count by shares: quorum first, then yes against no", () => {
    const total = 1_000_000_000_000;
    expect(boardOutcome(250_000_000_000, 0, total)).toBe("no_quorum");
    expect(boardOutcome(350_000_000_000, 0, total)).toBe("passed");
    expect(boardOutcome(250_000_000_000, 600_000_000_000, total)).toBe("rejected");
    expect(boardOutcome(300_000_000_000, 300_000_000_000, total)).toBe("rejected");
    expect(boardDecided(510_000_000_000, 0, total)).toBe(true);
    expect(boardDecided(500_000_000_000, 0, total)).toBe(false);
    expect(boardDecided(0, 500_000_000_000, total)).toBe(true);
  });

  it("the AI float protects shareholders only while the reputation is low", () => {
    expect(aiFloatVote("payout_cap", 39)).toBe("yes");
    expect(aiFloatVote("withdraw_ban", 10)).toBe("yes");
    expect(aiFloatVote("dividend", 39.9)).toBe("yes");
    expect(aiFloatVote("payout_cap", 40)).toBe("abstain");
    expect(aiFloatVote("earmark", 10)).toBe("abstain");
  });
});

describe("listed companies: books and taxes", () => {
  it("investments are operating costs, payouts and taxes are not", () => {
    for (const c of OPERATING_CATEGORIES) expect(isOperating(c)).toBe(true);
    for (const c of ["capital", "payout", "dividend", "tax", "penalty", "transfer"] as const)
      expect(isOperating(c)).toBe(false);
  });

  it("the tax rate falls with research, never below the minimum", () => {
    expect(taxRateBps(0)).toBe(1_500);
    expect(taxRateBps(-400)).toBe(1_100);
    expect(taxRateBps(-9_000)).toBe(800);
  });

  it("tax on the profit after the carried loss, discount off the tax (SQL)", () => {
    expect(booksTax(1_000_000, 600_000, 150_000, 1_400, 500)).toEqual({
      profitCents: 400_000,
      lossUsedCents: 150_000,
      taxableCents: 250_000,
      discountCents: 1_750,
      taxCents: 33_250,
      lossCarryCents: 0,
    });
    expect(booksTax(100, 500, 50, 1_500, 500)).toEqual({
      profitCents: -400,
      lossUsedCents: 0,
      taxableCents: 0,
      discountCents: 0,
      taxCents: 0,
      lossCarryCents: 450,
    });
    expect(booksTax(1_000, 0, 5_000, 1_500, 0).lossCarryCents).toBe(4_000);
    expect(booksTax(1_000, 0, 5_000, 1_500, 0).taxCents).toBe(0);
  });

  it("a normal company keeps most of its profit: 15 % at most", () => {
    // 5 000 € revenue and 1 000 € profit per hour, one day
    const day = booksTax(12_000_000, 9_600_000, 0, taxRateBps(0), booksDiscountBps(3, false));
    expect(day.taxCents).toBe(342_000);
    expect(day.taxCents / day.profitCents).toBeLessThan(0.15);
    // a research of 25 000 € on that day: no tax, a loss carried forward
    const invested = booksTax(12_000_000, 9_600_000 + 2_500_000, 0, 1_500, 0);
    expect(invested.taxCents).toBe(0);
    expect(invested.lossCarryCents).toBe(100_000);
  });

  it("skipped books: reminder, late fee, estimate (SQL)", () => {
    expect(booksStage(100, 0)).toBe("none");
    expect(booksStage(5, 1)).toBe("open");
    expect(booksStage(30, 1)).toBe("reminder");
    expect(booksStage(42, 1)).toBe("late");
    expect(booksStage(60, 1)).toBe("estimate");
    expect(lateFeeCents(2_000_000)).toBe(10_000);
    expect(lateFeeCents(100)).toBe(5_000);
    expect(estimateTax(1_000_000, 900_000, 1_500)).toEqual({
      taxableCents: 250_000,
      taxCents: 37_500,
      surchargeCents: 9_375,
    });
    expect(estimateTax(1_000_000, 500_000, 1_500).taxableCents).toBe(500_000);
    expect(latePaymentCents(33_250, false)).toBe(1_662);
    expect(latePaymentCents(33_250, true)).toBe(3_325);
  });

  it("the receipt check: all right gives the discount, the advisor a bigger one", () => {
    expect(gradeReceipts(["revenue", "goods", "wages"], ["revenue", "goods", "wages"])).toBe(3);
    expect(gradeReceipts(["revenue", "goods", "wages"], ["revenue", "wages"])).toBe(1);
    expect(booksDiscountBps(3, false)).toBe(500);
    expect(booksDiscountBps(2, false)).toBe(0);
    expect(booksDiscountBps(0, true)).toBe(800);
    const picked = pickReceipts([0, 0.5, 0.999]);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
    expect(picked[0]).toBe(0);
    for (const r of BALANCE.listed.taxes.receipts)
      expect(BALANCE.listed.taxes.receiptCategories as readonly string[]).toContain(r.category);
  });

  it("the advisor costs by the hour", () => {
    expect(advisorWageCents(20_000)).toBe(6_000);
    // ADR-209: the rate grows exponentially with every tenfold revenue (× 2.4), at most 30 %
    expect(advisorWageCents(100_000)).toBe(6_000);
    expect(advisorWageCents(1_000_000)).toBe(36_000);
    expect(advisorWageCents(10_000_000)).toBe(864_000);
    expect(advisorWageCents(1_000_000_000)).toBe(300_000_000);
  });

  it("taxes rise progressively with the profit per day, independent of the period length (ADR-209)", () => {
    // small: only the base rate
    expect(progressiveTaxCents(2_400_000, 1_500, 24)).toBe(360_000);
    // 500 000 € a day: 15 % + 3 % on the part above 100 000 €
    expect(progressiveTaxCents(50_000_000, 1_500, 24)).toBe(7_500_000 + 1_200_000);
    // the same profit rate over half a day pays the same share
    expect(progressiveTaxCents(25_000_000, 1_500, 12)).toBe((7_500_000 + 1_200_000) / 2);
    expect(progressiveTaxCents(0, 1_500, 24)).toBe(0);
    // books close with the brackets when the period length is known
    expect(booksTax(60_000_000, 10_000_000, 0, 1_500, 0, 24).taxCents).toBe(7_500_000 + 1_200_000);
    expect(booksTax(60_000_000, 10_000_000, 0, 1_500, 0).taxCents).toBe(7_500_000);
  });
});
