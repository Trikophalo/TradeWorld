import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { allocateDemand, attractiveness, marketingAwarenessGain, marketShares, nextAwareness } from "./market-share.ts";

const sum = (xs: readonly number[]) => xs.reduce((a, x) => a + x, 0);

describe("attractiveness", () => {
  it("implements quality^1.2 x awareness^0.8 / price^1.5", () => {
    const a = attractiveness({ quality: 50, awareness: 0.3, price: 2000 });
    expect(a).toBeCloseTo((50 ** 1.2 * 0.3 ** 0.8) / 2000 ** 1.5, 12);
  });

  it("rises with quality and awareness and falls with price", () => {
    const base = attractiveness({ quality: 50, awareness: 0.3, price: 2000 });
    expect(attractiveness({ quality: 60, awareness: 0.3, price: 2000 })).toBeGreaterThan(base);
    expect(attractiveness({ quality: 50, awareness: 0.4, price: 2000 })).toBeGreaterThan(base);
    expect(attractiveness({ quality: 50, awareness: 0.3, price: 2500 })).toBeLessThan(base);
  });

  it("handles degenerate input", () => {
    expect(attractiveness({ quality: 0, awareness: 0.3, price: 10 })).toBe(0);
    expect(() => attractiveness({ quality: 10, awareness: 0.3, price: 0 })).toThrow(RangeError);
  });
});

describe("marketShares", () => {
  it("sums to 1", () => {
    const shares = marketShares([0.3, 1.7, 0.02, 4.4, 0]);
    expect(sum(shares)).toBeCloseTo(1, 12);
    expect(shares[4]).toBe(0);
  });

  it("returns zeros if nobody is attractive", () => {
    expect(marketShares([0, 0])).toEqual([0, 0]);
  });

  it("a price cut raises the own share and lowers every competitor's", () => {
    const firms = [
      { quality: 60, awareness: 0.5, price: 2000 },
      { quality: 50, awareness: 0.3, price: 1900 },
      { quality: 40, awareness: 0.1, price: 1700 },
    ];
    const before = marketShares(firms.map((f) => attractiveness(f)));
    const cut = firms.map((f, i) => (i === 1 ? { ...f, price: 1600 } : f));
    const after = marketShares(cut.map((f) => attractiveness(f)));
    expect(after[1]).toBeGreaterThan(before[1] as number);
    expect(after[0]).toBeLessThan(before[0] as number);
    expect(after[2]).toBeLessThan(before[2] as number);
    expect(sum(after)).toBeCloseTo(1, 12);
  });
});

describe("allocateDemand", () => {
  it("equals demand x share when nobody is capped", () => {
    const { revenues, shares, unservedDemand } = allocateDemand(1000, [
      { attractiveness: 1, capacityRevenue: Infinity },
      { attractiveness: 3, capacityRevenue: Infinity },
    ]);
    expect(revenues).toEqual([250, 750]);
    expect(shares).toEqual([0.25, 0.75]);
    expect(unservedDemand).toBe(0);
  });

  it("caps a company and hands its unmet demand to the others", () => {
    const { revenues, unservedDemand } = allocateDemand(1000, [
      { attractiveness: 2, capacityRevenue: 100 },
      { attractiveness: 1, capacityRevenue: Infinity },
      { attractiveness: 1, capacityRevenue: Infinity },
    ]);
    expect(revenues).toEqual([100, 450, 450]);
    expect(unservedDemand).toBe(0);
  });

  it("cascades when redistribution pushes another company to its cap", () => {
    const { revenues, unservedDemand } = allocateDemand(1000, [
      { attractiveness: 5, capacityRevenue: 100 },
      { attractiveness: 3, capacityRevenue: 400 },
      { attractiveness: 2, capacityRevenue: Infinity },
    ]);
    // Round 1: 500/300/200 -> first capped. Round 2: 900 split 3:2 = 540/360 -> second capped.
    expect(revenues).toEqual([100, 400, 500]);
    expect(unservedDemand).toBe(0);
  });

  it("leaves demand unserved only when everyone is at capacity", () => {
    const { revenues, shares, unservedDemand } = allocateDemand(1000, [
      { attractiveness: 1, capacityRevenue: 100 },
      { attractiveness: 1, capacityRevenue: 200 },
    ]);
    expect(revenues).toEqual([100, 200]);
    expect(unservedDemand).toBe(700);
    expect(sum(shares)).toBeCloseTo(0.3, 12);
  });

  it("never allocates more than demand or capacity (property)", () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 200; round++) {
      const demand = rand() * 1e6;
      const claims = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => ({
        attractiveness: rand() < 0.1 ? 0 : rand() * 10,
        capacityRevenue: rand() < 0.3 ? Infinity : rand() * 4e5,
      }));
      const { revenues, unservedDemand } = allocateDemand(demand, claims);
      revenues.forEach((r, i) => {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual((claims[i]?.capacityRevenue ?? 0) + 1e-6);
        if (claims[i]?.attractiveness === 0) expect(r).toBe(0);
      });
      expect(sum(revenues) + unservedDemand).toBeCloseTo(demand, 4);
    }
  });

  it("ignores companies without attractiveness or capacity", () => {
    const { revenues } = allocateDemand(100, [
      { attractiveness: 0, capacityRevenue: Infinity },
      { attractiveness: 1, capacityRevenue: 0 },
      { attractiveness: 1, capacityRevenue: Infinity },
    ]);
    expect(revenues).toEqual([0, 0, 100]);
  });
});

describe("marketing", () => {
  it("derives the exponent from 'double budget = +40 %'", () => {
    expect(BALANCE.company.marketing.diminishingReturnsExponent).toBeCloseTo(Math.log2(1.4), 5);
  });

  it("doubling the budget multiplies the gain by 1.4", () => {
    const g1 = marketingAwarenessGain(10_000, 3_000_000);
    const g2 = marketingAwarenessGain(20_000, 3_000_000);
    expect(g2 / g1).toBeCloseTo(1.4, 4);
  });

  it("gives the reference gain at the reference budget and caps the gain", () => {
    const cfg = BALANCE.company.marketing;
    expect(marketingAwarenessGain(500, 500)).toBeCloseTo(cfg.gainAtReferenceBudget, 12);
    expect(marketingAwarenessGain(1e12, 500)).toBe(cfg.maxGainPerQuarter);
    expect(marketingAwarenessGain(0, 500)).toBe(0);
  });

  it("decays awareness without budget but never below the floor", () => {
    const cfg = BALANCE.company.marketing;
    expect(nextAwareness(0.5, 0, 1000)).toBeCloseTo(0.5 * (1 - cfg.awarenessDecayPerQuarter), 12);
    expect(nextAwareness(cfg.minAwareness, 0, 1000)).toBe(cfg.minAwareness);
  });

  it("saturates below 1", () => {
    let a = 0.1;
    for (let i = 0; i < 500; i++) a = nextAwareness(a, 1e12, 1000);
    expect(a).toBeLessThan(1);
    expect(a).toBeGreaterThan(0.5);
  });
});
