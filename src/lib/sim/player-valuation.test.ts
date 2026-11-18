import { describe, expect, it } from "vitest";
import { PLAYER_VALUATION } from "../../config/player-valuation.ts";
import {
  countedCash,
  expectedYearlyProfit,
  fadeShock,
  growthFactor,
  growthLog,
  legacyCompanyValue,
  moodFactor,
  nextAnchor,
  playerCompanyValue,
  playerFairValueE4,
  sectorCycleFactor,
  type PlayerValuationInput,
} from "./player-valuation.ts";

const base: PlayerValuationInput = {
  profitRecentCents: 24 * 100_000,
  hoursRecent: 24,
  profitPriorCents: 24 * 100_000,
  hoursPrior: 24,
  cashCents: 1_000_000,
  anchorCents: 1_000_000,
  sector: "retail",
  peRatio: 14,
  peDiscount: 0.5,
  mood: 50,
  // sin(2π (h / 131 + 0,55)) = 0 for retail at h = 131 × 0,45
  hours: 131 * 0.45,
};

describe("player valuation (ADR-217)", () => {
  it("scales the expected yearly profit from the hours that exist", () => {
    expect(expectedYearlyProfit(2_400, 24)).toBe(2_400);
    expect(expectedYearlyProfit(1_200, 12)).toBe(2_400);
    // fewer than minProfitHours: scaled from minProfitHours only
    expect(expectedYearlyProfit(100, 2)).toBe(400);
    expect(expectedYearlyProfit(-500, 24)).toBe(0);
    expect(expectedYearlyProfit(500, 0)).toBe(0);
  });

  it("prices growth expectations in at once and contracts the multiple when growth stops", () => {
    expect(growthLog(200, 100)).toBeCloseTo(Math.log(2));
    expect(growthLog(100, null)).toBe(0);
    expect(growthLog(100, -50)).toBe(10);
    expect(growthLog(-10, 50)).toBe(-10);
    expect(growthFactor(Math.log(1.5))).toBeCloseTo(Math.exp(PLAYER_VALUATION.growth.perLogGrowth * Math.log(1.5)));
    expect(growthFactor(10)).toBeCloseTo(Math.exp(PLAYER_VALUATION.growth.maxLog));
    expect(growthFactor(-10)).toBeCloseTo(Math.exp(-PLAYER_VALUATION.growth.maxLog));
    const growing = playerCompanyValue({ ...base, profitPriorCents: 12 * 100_000 });
    const steady = playerCompanyValue(base);
    expect(growing.valueCents).toBeGreaterThan(steady.valueCents * 1.3);
  });

  it("cuts the multiple in bear phases and lifts it in bull phases", () => {
    expect(moodFactor(50)).toBe(1);
    expect(moodFactor(28)).toBeCloseTo(Math.exp(-22 * PLAYER_VALUATION.mood.perPoint));
    expect(moodFactor(68)).toBeCloseTo(Math.exp(18 * PLAYER_VALUATION.mood.perPoint));
    expect(moodFactor(28)).toBeLessThan(0.85);
    const bear = playerCompanyValue({ ...base, mood: 28 });
    const bull = playerCompanyValue({ ...base, mood: 68 });
    expect(bear.valueCents).toBeLessThan(playerCompanyValue(base).valueCents);
    expect(bull.valueCents).toBeGreaterThan(playerCompanyValue(base).valueCents);
  });

  it("lets sector P/E move in cycles of a few days", () => {
    const f = Array.from({ length: 300 }, (_, h) => sectorCycleFactor("tech", h));
    const a = PLAYER_VALUATION.sectorCycle.amplitude;
    expect(Math.max(...f)).toBeCloseTo(Math.exp(a), 2);
    expect(Math.min(...f)).toBeCloseTo(Math.exp(-a), 2);
    expect(sectorCycleFactor("tech", 10)).toBeCloseTo(sectorCycleFactor("tech", 10 + 83));
    expect(sectorCycleFactor("unknown", 0)).toBeCloseTo(Math.exp(a * Math.sin(2 * Math.PI * 0.45)));
  });

  it("counts piled-up cash only up to the reserve", () => {
    // reserve = max(anchor, 0,5 × yearly profit)
    expect(countedCash(1_000, 2_000, 0)).toBe(1_000);
    expect(countedCash(10_000, 2_000, 0)).toBe(2_000 + 0.03 * 8_000);
    expect(countedCash(10_000, 0, 12_000)).toBe(6_000 + 0.03 * 4_000);
    expect(countedCash(-500, 2_000, 0)).toBe(-500);
  });

  it("does not rise when a company with steady profit only piles up cash", () => {
    // old: every quarter one quarter's profit more cash and a higher fair value
    const q = 6 * 100_000;
    const legacy0 = legacyCompanyValue(1_000_000, q, 14, 0.5);
    const legacy28 = legacyCompanyValue(1_000_000 + 28 * q, q, 14, 0.5);
    expect(legacy28 / legacy0).toBeGreaterThan(1.8);
    // new: the same week of piled-up cash adds less than 5 %
    const now0 = playerCompanyValue(base).valueCents;
    const now28 = playerCompanyValue({ ...base, cashCents: base.cashCents + 28 * q }).valueCents;
    expect(now28 / now0).toBeLessThan(1.05);
  });

  it("never values a cash-rich company far below its cash", () => {
    const v = playerCompanyValue({
      ...base,
      profitRecentCents: 0,
      profitPriorCents: 0,
      cashCents: 50_000_000,
      anchorCents: 0,
    });
    expect(v.valueCents).toBeCloseTo(PLAYER_VALUATION.liquidationWeight * 50_000_000);
  });

  it("clamps the multiple", () => {
    const low = playerCompanyValue({ ...base, profitPriorCents: 1e12, mood: 0, hours: 131 * 0.7 });
    expect(low.multiple).toBeGreaterThanOrEqual(PLAYER_VALUATION.minMultiple);
    const high = playerCompanyValue({ ...base, profitPriorCents: 1, mood: 100, hours: 131 * 0.2 });
    expect(high.multiple).toBeLessThanOrEqual(PLAYER_VALUATION.maxMultiple);
  });

  it("gives a fair value per share with the reputation factor", () => {
    expect(playerFairValueE4(1_000_000, 1_000_000)).toBe(100);
    expect(playerFairValueE4(1_000_000, 1_000_000, 1.25)).toBe(125);
    expect(playerFairValueE4(0, 1_000)).toBe(1);
  });

  it("lets shocks from outside fade with the half-life", () => {
    expect(fadeShock(0.8, 0)).toBeCloseTo(0.8);
    expect(Math.log(fadeShock(0.8, 180))).toBeCloseTo(Math.log(0.8) / 2);
    expect(fadeShock(0, 10)).toBe(1);
  });

  it("keeps the cash anchor below the cash and adds capital increases", () => {
    expect(nextAnchor(1_000, 600, 1_000, false)).toBe(600);
    expect(nextAnchor(1_000, 5_000, 1_200, false)).toBe(1_000);
    expect(nextAnchor(1_000, 5_000, 1_200, true)).toBe(4_800);
    expect(nextAnchor(1_000, -50, 0, false)).toBe(0);
  });
});
