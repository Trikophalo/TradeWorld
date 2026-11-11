import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  activityDecay,
  aiWeight,
  anchoredFairValue,
  nextActivityCents,
  playerImpactReturn,
  sharesValueCents,
} from "./player-influence.ts";

const EUR = 100; // cents
const priceE4 = 50 * 10_000; // 50 €

describe("player impact", () => {
  it("10.000 € net buying moves a penny stock 2 %, a mid cap 0.4 %, a blue chip 0.1 %", () => {
    const shares = (10_000 * EUR * 100) / priceE4; // 200 shares at 50 €
    expect(sharesValueCents(shares, priceE4)).toBe(10_000 * EUR);
    expect(playerImpactReturn(shares, priceE4, "penny")).toBeCloseTo(0.02, 12);
    expect(playerImpactReturn(shares, priceE4, "midcap")).toBeCloseTo(0.004, 12);
    expect(playerImpactReturn(shares, priceE4, "bluechip")).toBeCloseTo(0.001, 12);
    expect(playerImpactReturn(-shares, priceE4, "penny")).toBeCloseTo(-0.02, 12);
    expect(playerImpactReturn(0, priceE4, "penny")).toBe(0);
  });

  it("depends on euros, not on the share price (split invariant)", () => {
    expect(playerImpactReturn(100, 1_000_000, "midcap")).toBeCloseTo(playerImpactReturn(1_000, 100_000, "midcap"), 12);
  });
});

describe("holdings premium", () => {
  it("is 0 without player holdings and grows to the maximum", () => {
    expect(anchoredFairValue(priceE4, 0, priceE4, "midcap")).toBe(priceE4);
    const scale =
      BALANCE.trading.playerImpact.premiumScaleDepths * BALANCE.trading.playerImpact.depthCentsPer100Bps.midcap;
    const shares = (scale * 100) / priceE4; // held value = one premium scale
    const lifted = anchoredFairValue(priceE4, shares, priceE4, "midcap");
    expect(lifted / priceE4 - 1).toBeCloseTo(BALANCE.trading.playerImpact.maxHoldingsPremium * Math.tanh(1), 9);
    const huge = anchoredFairValue(priceE4, shares * 1_000, priceE4, "midcap");
    expect(huge / priceE4).toBeCloseTo(1 + BALANCE.trading.playerImpact.maxHoldingsPremium, 6);
  });
});

describe("AI weight", () => {
  it("is 1 without players and falls towards the floor with player activity", () => {
    expect(aiWeight(0, "bluechip")).toBe(1);
    const ref = BALANCE.aiInvestors.playerWeight.referenceActivityCents.bluechip;
    expect(aiWeight(ref, "bluechip")).toBeCloseTo(0.5, 12);
    expect(aiWeight(ref * 1_000, "bluechip")).toBe(BALANCE.aiInvestors.playerWeight.minAiWeight);
  });

  it("player activity halves after the half-life", () => {
    const ticks = (BALANCE.aiInvestors.playerWeight.activityHalfLifeHours * 3600) / BALANCE.time.tickSeconds;
    expect(Math.pow(activityDecay(BALANCE.time.tickSeconds), ticks)).toBeCloseTo(0.5, 9);
    expect(nextActivityCents(1_000, -200, 5)).toBeCloseTo(1_000 * activityDecay(5) + 200, 9);
  });
});
