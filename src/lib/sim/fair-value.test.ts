import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  analystPriceTargetE4,
  fairValueE4,
  growthFactor,
  macroFactor,
  reputationValuationFactor,
  trailingRevenueGrowth,
} from "./fair-value.ts";
import { createRng } from "./rng.ts";

const tech = BALANCE.sectors.tech;
const retail = BALANCE.sectors.retail;

describe("reputationValuationFactor", () => {
  it("maps 0..100 to 0.6..1.4", () => {
    expect(reputationValuationFactor(0)).toBeCloseTo(0.6, 12);
    expect(reputationValuationFactor(50)).toBeCloseTo(1.0, 12);
    expect(reputationValuationFactor(100)).toBeCloseTo(1.4, 12);
    expect(reputationValuationFactor(-20)).toBeCloseTo(0.6, 12);
    expect(reputationValuationFactor(500)).toBeCloseTo(1.4, 12);
  });
});

describe("macroFactor", () => {
  it("is 1 at the neutral rate", () => {
    expect(macroFactor(BALANCE.centralBank.neutralRateBps)).toBe(1);
  });

  it("falls when the policy rate rises", () => {
    expect(macroFactor(400)).toBeCloseTo(0.96, 12);
    expect(macroFactor(200)).toBeCloseTo(1.04, 12);
    expect(macroFactor(400, 1.5)).toBeCloseTo(0.94, 12);
  });

  it("is clamped", () => {
    expect(macroFactor(100_000)).toBe(BALANCE.valuation.macroFactorMin);
    expect(macroFactor(-100_000)).toBe(BALANCE.valuation.macroFactorMax);
  });
});

describe("growth", () => {
  it("clamps the growth factor", () => {
    expect(growthFactor(0)).toBe(1);
    expect(growthFactor(0.2)).toBeCloseTo(1.2, 12);
    expect(growthFactor(5)).toBe(BALANCE.valuation.growthFactorMax);
    expect(growthFactor(-5)).toBe(BALANCE.valuation.growthFactorMin);
  });

  it("compares the last four quarters with the four before", () => {
    const b = (n: number) => BigInt(n);
    expect(trailingRevenueGrowth([b(1), b(2)])).toBe(0);
    expect(trailingRevenueGrowth([b(100), b(100), b(100), b(100), b(110), b(110), b(110), b(110)])).toBeCloseTo(
      0.1,
      12,
    );
    expect(trailingRevenueGrowth([b(0), b(0), b(0), b(0), b(1), b(1), b(1), b(1)])).toBe(0);
  });
});

describe("fairValueE4", () => {
  const base = {
    epsTtmCents: 400, // 4.00 EUR
    sector: retail,
    revenueGrowth: 0,
    founderReputation: null,
    policyRateBps: 300,
    bookValuePerShareCents: 1000,
  };

  it("is EPS x P/E at neutral conditions", () => {
    // 4.00 EUR x 14 = 56.00 EUR
    expect(fairValueE4(base)).toBe(BigInt(560_000));
  });

  it("applies growth, reputation and macro factors multiplicatively", () => {
    const value = fairValueE4({ ...base, revenueGrowth: 0.25, founderReputation: 100, policyRateBps: 400 });
    const expected = 400 * 14 * 1.25 * 1.4 * (1 - 0.04 * retail.sensitivity.valuationRate) * 100;
    expect(Number(value)).toBeCloseTo(expected, -1);
  });

  it("values a bad reputation at 0.6x and a great one at 1.4x", () => {
    const low = Number(fairValueE4({ ...base, founderReputation: 0 }));
    const high = Number(fairValueE4({ ...base, founderReputation: 100 }));
    expect(low).toBeCloseTo(560_000 * 0.6, -1);
    expect(high).toBeCloseTo(560_000 * 1.4, -1);
  });

  it("falls when the policy rate rises, tech more than retail", () => {
    const retailDrop = Number(fairValueE4({ ...base, policyRateBps: 500 })) / Number(fairValueE4(base));
    const techBase = { ...base, sector: tech };
    const techDrop = Number(fairValueE4({ ...techBase, policyRateBps: 500 })) / Number(fairValueE4(techBase));
    expect(retailDrop).toBeLessThan(1);
    expect(techDrop).toBeLessThan(retailDrop);
  });

  it("uses the book value floor for loss makers and never returns <= 0", () => {
    expect(fairValueE4({ ...base, epsTtmCents: -500 })).toBe(BigInt(50_000)); // 50 % of 10.00 EUR
    expect(fairValueE4({ ...base, epsTtmCents: -500, bookValuePerShareCents: -100 })).toBe(BigInt(1));
  });

  it("scales with the binary event factor", () => {
    expect(fairValueE4({ ...base, eventValueFactor: 0.4 })).toBe(BigInt(224_000));
  });
});

describe("analystPriceTargetE4", () => {
  it("is deterministic and scatters around the fair value", () => {
    const fair = BigInt(1_000_000);
    expect(analystPriceTargetE4(fair, createRng(1))).toBe(analystPriceTargetE4(fair, createRng(1)));
    const rng = createRng(2);
    let sumLog = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const target = analystPriceTargetE4(fair, rng);
      expect(target > BigInt(0)).toBe(true);
      sumLog += Math.log(Number(target) / Number(fair));
    }
    expect(Math.abs(sumLog / n)).toBeLessThan(0.02);
  });
});
