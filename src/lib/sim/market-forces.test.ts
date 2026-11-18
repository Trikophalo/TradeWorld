import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { MARKET_FORCES } from "../../config/market-forces.ts";
import {
  forceChancePerHour,
  forceMoveBps,
  forceSentimentDelta,
  forceStrength,
  forceWeight,
  perMinute,
  pickForce,
  quantile,
  simulateStockPath,
  stockHeat,
  waveChancePerHour,
  waveMoveBps,
} from "./market-forces.ts";

const calm = { priceE4: 10_000, fairValueE4: 10_000, price24hE4: 10_000, price7dE4: 10_000 };

describe("stockHeat (ADR-214)", () => {
  it("is zero for a stock near its value without big gains", () => {
    expect(stockHeat(calm)).toEqual({ heat: 0, cold: 0 });
    expect(stockHeat({ ...calm, priceE4: 12_000, price24hE4: 10_000 })).toEqual({ heat: 0, cold: 0 });
  });

  it("adds premium, 24-hour and 7-day gain above their free share", () => {
    const h = MARKET_FORCES.heat;
    const premium = stockHeat({ ...calm, priceE4: 20_000, price24hE4: 20_000, price7dE4: 20_000 });
    expect(premium.heat).toBeCloseTo((Math.log(2) - h.premiumFree) / h.premiumScale, 9);
    const day = stockHeat({ priceE4: 20_000, fairValueE4: 20_000, price24hE4: 10_000, price7dE4: 20_000 });
    expect(day.heat).toBeCloseTo((Math.log(2) - h.gain24hFree) / h.gain24hScale, 9);
    const week = stockHeat({ priceE4: 40_000, fairValueE4: 40_000, price24hE4: 40_000, price7dE4: 10_000 });
    expect(week.heat).toBeCloseTo((Math.log(4) - h.gain7dFree) / h.gain7dScale, 9);
  });

  it("does not count gains while the price is clearly below its fair value (an earned rise is no bubble)", () => {
    expect(stockHeat({ priceE4: 20_000, fairValueE4: 40_000, price24hE4: 10_000, price7dE4: 5_000 }).heat).toBe(0);
    expect(
      stockHeat({ priceE4: 20_000, fairValueE4: 21_000, price24hE4: 10_000, price7dE4: 20_000 }).heat,
    ).toBeGreaterThan(0);
  });

  it("is capped and ignores missing history", () => {
    expect(stockHeat({ priceE4: 1_000_000, fairValueE4: 1, price24hE4: 1, price7dE4: 1 }).heat).toBe(
      MARKET_FORCES.heat.maxHeat,
    );
    expect(stockHeat({ priceE4: 10_000, fairValueE4: 10_000, price24hE4: null, price7dE4: null }).heat).toBe(0);
  });

  it("measures cold for a stock far below its value or after a crash", () => {
    expect(stockHeat({ ...calm, priceE4: 4_000, price24hE4: 4_000, price7dE4: 4_000 }).cold).toBeGreaterThan(0);
    expect(stockHeat({ ...calm, priceE4: 5_000, fairValueE4: 5_000, price7dE4: 5_000 }).cold).toBeGreaterThan(0);
    expect(stockHeat({ ...calm, priceE4: 5_000, fairValueE4: 5_000, price7dE4: 5_000 }).heat).toBe(0);
  });
});

describe("chances and picks", () => {
  it("rises with heat and stays within the cap", () => {
    const c = MARKET_FORCES.chance;
    expect(forceChancePerHour({ heat: 0, cold: 0 })).toBe(c.basePerHour);
    expect(forceChancePerHour({ heat: 1, cold: 0 })).toBeCloseTo(c.basePerHour + c.perHeatPerHour, 9);
    expect(forceChancePerHour({ heat: 4, cold: 4 })).toBe(c.maxPerHour);
    expect(perMinute(60)).toBeCloseTo(1 - Math.exp(-1), 9);
    expect(perMinute(-1)).toBe(0);
  });

  it("an overheated stock draws only damping forces, a cold one only lifting ones", () => {
    for (let u = 0; u < 1; u += 0.01) {
      expect(pickForce({ heat: 2, cold: 0 }, u)?.direction ?? -1).toBe(-1);
      expect(pickForce({ heat: 0, cold: 2 }, u)?.direction ?? 1).toBe(1);
    }
    // a calm stock gets the background forces, up and down
    const calmPicks = new Set(Array.from({ length: 100 }, (_, i) => pickForce({ heat: 0, cold: 0 }, i / 100)?.key));
    expect([...calmPicks].sort()).toEqual(["fund_entry", "rotation"]);
  });

  it("heavy forces need heat (bubble warning from 2, audit from 1,5)", () => {
    const bubble = MARKET_FORCES.forces.find((f) => f.key === "bubble_warning")!;
    expect(forceWeight(bubble, { heat: 1.9, cold: 0 })).toBe(0);
    expect(forceWeight(bubble, { heat: 2, cold: 0 })).toBe(bubble.weight * 2);
    expect(pickForce({ heat: 0, cold: 0 }, 0.5, [bubble])).toBeNull();
  });

  it("hotter stocks fall harder, never more than maxMoveBps", () => {
    const f = MARKET_FORCES.forces[0]!;
    expect(forceMoveBps(f, { heat: 0, cold: 0 }, 0)).toBe(f.minMoveBps);
    expect(forceMoveBps(f, { heat: 0, cold: 0 }, 1)).toBe(f.maxMoveBps);
    expect(forceMoveBps(f, { heat: 2, cold: 0 }, 0.5)).toBeGreaterThan(forceMoveBps(f, { heat: 0, cold: 0 }, 0.5));
    expect(forceMoveBps(f, { heat: 0, cold: 4 }, 0.5)).toBe(forceMoveBps(f, { heat: 0, cold: 0 }, 0.5));
    expect(forceMoveBps({ direction: -1, minMoveBps: 400, maxMoveBps: 100_000 }, { heat: 4, cold: 0 }, 1)).toBe(
      MARKET_FORCES.maxMoveBps,
    );
    expect(waveMoveBps({ heat: 0, cold: 0 }, 0, -1)).toBe(300);
  });

  it("waves only with heat; strength and mood follow the move", () => {
    expect(waveChancePerHour(0)).toBe(0);
    expect(waveChancePerHour(1)).toBeCloseTo(MARKET_FORCES.waves.basePerHour + MARKET_FORCES.waves.perHeatPerHour, 9);
    expect(waveChancePerHour(100)).toBe(MARKET_FORCES.waves.maxPerHour);
    expect([forceStrength(500), forceStrength(1_000), forceStrength(3_000)]).toEqual([1, 2, 3]);
    expect(forceSentimentDelta(-1_000)).toBeCloseTo(-0.2, 9);
    expect(forceSentimentDelta(-9_000)).toBe(-1);
  });

  it("is the game's config, and no daily band is left", () => {
    expect(BALANCE.marketForces).toBe(MARKET_FORCES);
    expect(BALANCE.trading.playerStocks.dailyBandBps).toBe(0);
    for (const f of MARKET_FORCES.forces) {
      expect(f.minMoveBps).toBeLessThanOrEqual(f.maxMoveBps);
      expect(f.headline).toContain("{name}");
    }
  });

  it("quantile picks the nearest rank", () => {
    expect(quantile([3, 1, 2], 0.5)).toBe(2);
    expect(quantile([], 0.5)).toBe(0);
  });
});

describe("simulateStockPath (harness)", () => {
  const hype = { days: 3, fairGrowthPerQuarter: 0, steadyBuyCentsPerHour: 2_000_000, chaseBuyCentsPerHour: 4_000_000 };

  it("is deterministic per seed", () => {
    const a = simulateStockPath({ ...hype, days: 1, dailyBandBps: 0, forces: true }, 3);
    expect(simulateStockPath({ ...hype, days: 1, dailyBandBps: 0, forces: true }, 3)).toEqual(a);
  });

  it("forces pull a hyped stock back towards its fair value, without a daily cap", () => {
    const seeds = [1, 2, 3];
    const before = seeds.map((s) => simulateStockPath({ ...hype, dailyBandBps: 10_000, forces: false }, s));
    const after = seeds.map((s) => simulateStockPath({ ...hype, dailyBandBps: 0, forces: true }, s));
    const premium = (runs: typeof before) =>
      quantile(
        runs.map((r) => r.endPremium),
        0.5,
      );
    expect(premium(after)).toBeLessThan(premium(before));
    expect(after.reduce((a, r) => a + r.forcesHit, 0)).toBeGreaterThan(0);
    // the old band held every day within +100 %
    for (const r of before) expect(r.maxDayGain).toBeLessThanOrEqual(1.0001);
  }, 60_000);
});
