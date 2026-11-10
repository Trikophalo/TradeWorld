import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  computeAllPressures,
  computeInvestorPressure,
  initialArchetypeStates,
  pensionTargetWeight,
  targetHoldingShares,
  trendSignal,
} from "./investors.ts";
import type { InvestorSignals } from "./investors.ts";
import { impactReturn } from "./price-impact.ts";
import { INVESTOR_ARCHETYPES } from "./types.ts";

const FLOAT = 10_000_000;
const base: InvestorSignals = {
  price: 100,
  fairValue: 100,
  emaFast: 100,
  emaSlow: 100,
  sentiment: 0,
  freeFloatShares: FLOAT,
  policyRateBps: 300,
  dividendYieldBps: 325,
  bondYieldBps: 325,
  inIndex: true,
  liquidityFactor: 1,
  holdingShares: 0,
};
const ai = BALANCE.aiInvestors.archetypes;

describe("value fund", () => {
  it("buys below fair value and sells above", () => {
    expect(computeInvestorPressure("value_fund", { ...base, price: 80 })).toBeGreaterThan(0);
    expect(computeInvestorPressure("value_fund", { ...base, price: 125 })).toBeLessThan(0);
  });

  it("ignores gaps inside the dead band", () => {
    expect(computeInvestorPressure("value_fund", { ...base, price: 100.5 })).toBe(0);
    expect(computeInvestorPressure("value_fund", base)).toBe(0);
  });

  it("presses harder the larger the gap, up to a cap", () => {
    const p10 = computeInvestorPressure("value_fund", { ...base, price: 90 });
    const p30 = computeInvestorPressure("value_fund", { ...base, price: 70 });
    const p90 = computeInvestorPressure("value_fund", { ...base, price: 10 });
    const p99 = computeInvestorPressure("value_fund", { ...base, price: 1 });
    expect(p30).toBeGreaterThan(p10);
    expect(p90).toBeCloseTo(FLOAT * ai.value_fund.capitalShare * ai.value_fund.reactionSpeed, 6);
    expect(p99).toBe(p90);
  });

  it("is antisymmetric in log space", () => {
    const below = computeInvestorPressure("value_fund", { ...base, price: 100 / 1.2 });
    const above = computeInvestorPressure("value_fund", { ...base, price: 100 * 1.2 });
    expect(below).toBeCloseTo(-above, 6);
  });
});

describe("momentum trader", () => {
  it("follows the trend in both directions", () => {
    expect(computeInvestorPressure("momentum_trader", { ...base, emaFast: 101 })).toBeGreaterThan(0);
    expect(computeInvestorPressure("momentum_trader", { ...base, emaFast: 99 })).toBeLessThan(0);
    expect(computeInvestorPressure("momentum_trader", base)).toBe(0);
  });

  it("is bounded", () => {
    const max = FLOAT * ai.momentum_trader.capitalShare * ai.momentum_trader.reactionSpeed;
    expect(computeInvestorPressure("momentum_trader", { ...base, emaFast: 1000 })).toBeCloseTo(max, 6);
    expect(trendSignal(0, 0)).toBe(0);
  });
});

describe("retail herd", () => {
  it("follows sentiment and chases trends", () => {
    expect(computeInvestorPressure("retail_herd", { ...base, sentiment: 0.5 })).toBeGreaterThan(0);
    expect(computeInvestorPressure("retail_herd", { ...base, sentiment: -0.5 })).toBeLessThan(0);
    expect(computeInvestorPressure("retail_herd", { ...base, emaFast: 103 })).toBeGreaterThan(0);
  });

  it("overreacts: at equal signal strength it trades more than the value fund", () => {
    const herd = computeInvestorPressure("retail_herd", { ...base, sentiment: 1 });
    const value = computeInvestorPressure("value_fund", { ...base, price: 1 });
    expect(herd).toBeGreaterThan(value);
  });
});

describe("pension fund", () => {
  it("is at rest at its target", () => {
    const target = targetHoldingShares("pension_fund", base) as number;
    expect(target).toBeCloseTo(FLOAT * ai.pension_fund.capitalShare, 6);
    expect(computeInvestorPressure("pension_fund", { ...base, holdingShares: target })).toBeCloseTo(0, 9);
  });

  it("rotates out of stocks when the policy rate rises", () => {
    const target = targetHoldingShares("pension_fund", base) as number;
    const hike = computeInvestorPressure("pension_fund", { ...base, holdingShares: target, policyRateBps: 400 });
    const cut = computeInvestorPressure("pension_fund", { ...base, holdingShares: target, policyRateBps: 200 });
    expect(hike).toBeLessThan(0);
    expect(cut).toBeGreaterThan(0);
  });

  it("prefers dividend stocks over bonds when they yield more", () => {
    expect(pensionTargetWeight(300, 600, 325)).toBeGreaterThan(pensionTargetWeight(300, 325, 325));
    expect(pensionTargetWeight(300, 0, 325)).toBeLessThan(1);
    expect(pensionTargetWeight(100_000, 0, 325)).toBe(ai.pension_fund.params.minWeight);
  });
});

describe("index fund", () => {
  it("buys on inclusion and sells on removal", () => {
    const target = FLOAT * ai.index_fund.capitalShare;
    expect(computeInvestorPressure("index_fund", { ...base, inIndex: true, holdingShares: 0 })).toBeCloseTo(
      target * ai.index_fund.reactionSpeed,
      6,
    );
    expect(computeInvestorPressure("index_fund", { ...base, inIndex: false, holdingShares: target })).toBeLessThan(0);
    expect(computeInvestorPressure("index_fund", { ...base, inIndex: true, holdingShares: target })).toBeCloseTo(0, 9);
  });

  it("the full inclusion purchase moves the price by a visible but bounded amount", () => {
    const depth = FLOAT * BALANCE.trading.priceImpact.depthFreeFloatFraction;
    const jump = impactReturn(FLOAT * ai.index_fund.capitalShare, depth);
    expect(jump).toBeGreaterThan(0.05);
    expect(jump).toBeLessThan(0.4);
  });
});

describe("market maker", () => {
  it("unwinds inventory taken from players", () => {
    // Players bought 1000 shares -> inventory -1000 -> the maker buys back.
    expect(computeInvestorPressure("market_maker", { ...base, holdingShares: -1000 })).toBeGreaterThan(0);
    expect(computeInvestorPressure("market_maker", { ...base, holdingShares: 1000 })).toBeLessThan(0);
    expect(computeInvestorPressure("market_maker", base)).toBeCloseTo(0, 12);
  });
});

describe("all archetypes", () => {
  it("returns a pressure for each of the six archetypes", () => {
    const holdings = {
      market_maker: 0,
      value_fund: 0,
      momentum_trader: 0,
      pension_fund: 0,
      index_fund: 0,
      retail_herd: 0,
    };
    const pressures = computeAllPressures(base, holdings);
    expect(Object.keys(pressures).sort()).toEqual([...INVESTOR_ARCHETYPES].sort());
    for (const a of INVESTOR_ARCHETYPES) expect(Number.isFinite(pressures[a])).toBe(true);
  });

  it("trades less in thin after-hours markets", () => {
    const open = computeInvestorPressure("value_fund", { ...base, price: 80 });
    const late = computeInvestorPressure("value_fund", { ...base, price: 80, liquidityFactor: 0.25 });
    expect(late).toBeCloseTo(open * 0.25, 9);
  });

  it("starts without artificial flows", () => {
    const states = initialArchetypeStates(base);
    const holdings = Object.fromEntries(INVESTOR_ARCHETYPES.map((a) => [a, states[a].holdingShares])) as Record<
      (typeof INVESTOR_ARCHETYPES)[number],
      number
    >;
    const pressures = computeAllPressures(base, holdings);
    for (const a of INVESTOR_ARCHETYPES) expect(pressures[a]).toBeCloseTo(0, 9);
    expect(initialArchetypeStates({ ...base, inIndex: false }).index_fund.holdingShares).toBe(0);
  });

  it("trend followers cannot outrun the value fund (stability)", () => {
    const value = ai.value_fund.capitalShare * ai.value_fund.reactionSpeed;
    const trend =
      ai.momentum_trader.capitalShare * ai.momentum_trader.reactionSpeed +
      ai.retail_herd.capitalShare * ai.retail_herd.reactionSpeed * (ai.retail_herd.params.chaseGain ?? 0);
    expect(trend).toBeLessThan(value);
    // Loop gain of the trend feedback: return per tick per unit of steady drift.
    const k =
      BALANCE.trading.priceImpact.impactBpsPerDepth / 10_000 / BALANCE.trading.priceImpact.depthFreeFloatFraction;
    const lag = 1 / BALANCE.aiInvestors.emaSlowAlpha - 1 / BALANCE.aiInvestors.emaFastAlpha;
    const loopGain = (k * trend * lag) / (ai.momentum_trader.params.trendScale ?? 1);
    expect(loopGain).toBeLessThan(1);
  });
});
