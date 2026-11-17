import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { type FillPlanInput, planMarketOrder, stockSlope } from "./order-fill.ts";

// The owner's sale (ADR-189): 58.877,58 shares of a penny player stock at a bid of about 1,63 €.
const touchE4 = 16_300;
const slope = stockSlope(touchE4, BALANCE.trading.playerImpact.depthCentsPer100Bps.penny, 1e12, 100);
const base: FillPlanInput = {
  side: "sell",
  touchE4,
  slope,
  pendingShares: 0,
  quantityE6: 58_877_583_251,
  amountCents: null,
  feeCents: 100,
  maxMoveBps: BALANCE.trading.priceImpact.maxImpactBpsPerOrder,
  bandLowE4: null,
  bandHighE4: null,
  minPriceE4: 1,
};

describe("planMarketOrder (ADR-189)", () => {
  it("without a cap reproduces the half-price fill of the bug report", () => {
    const plan = planMarketOrder({ ...base, maxMoveBps: 1_000_000 });
    expect(plan.fillE6).toBe(base.quantityE6);
    expect(plan.avgPriceE4).toBeGreaterThan(8_400);
    expect(plan.avgPriceE4).toBeLessThan(8_600);
    expect(plan.grossCents).toBeLessThan(5_100_000);
  });

  it("caps the move of the last share and reports the rest", () => {
    const plan = planMarketOrder(base);
    expect(plan.limitedBy).toBe("impact");
    expect(plan.fillE6 + plan.unfilledE6).toBe(base.quantityE6);
    expect(plan.lastPriceE4).toBeGreaterThanOrEqual(Math.floor(touchE4 * 0.85) - 1);
    expect(plan.slippageBps).toBeLessThanOrEqual(751);
    expect(plan.impactBps).toBeGreaterThanOrEqual(-1500);
    // proceeds per share stay close to the quote
    expect(plan.avgPriceE4).toBeGreaterThanOrEqual(touchE4 * 0.925 - 1);
  });

  it("small orders fill fully with the disclosed slippage", () => {
    const plan = planMarketOrder({ ...base, quantityE6: 1_000_000_000 });
    expect(plan.limitedBy).toBeNull();
    expect(plan.unfilledE6).toBe(0);
    expect(plan.netCents).toBe(plan.grossCents - 100);
    expect(plan.avgPriceE4).toBe(Math.round(touchE4 * (1 - slope * 500)));
  });

  it("the daily band limits before the cap", () => {
    const plan = planMarketOrder({ ...base, bandLowE4: 15_500 });
    expect(plan.limitedBy).toBe("band");
    expect(plan.lastPriceE4).toBeGreaterThanOrEqual(15_499);
    const none = planMarketOrder({ ...base, bandLowE4: 17_000 });
    expect(none.fillE6).toBe(0);
  });

  it("amount orders solve the price path exactly", () => {
    const sell = planMarketOrder({ ...base, quantityE6: null, amountCents: 1_000_000 });
    // the average price is rounded to 0,0001 €, so the proceeds are exact within that rounding
    expect(Math.abs(sell.grossCents - 1_000_000)).toBeLessThanOrEqual(100);
    const buy = planMarketOrder({ ...base, side: "buy", quantityE6: null, amountCents: 1_000_000 });
    expect(buy.netCents).toBeLessThanOrEqual(1_000_000);
    expect(buy.netCents).toBeGreaterThan(999_900);
    expect(buy.avgPriceE4).toBeGreaterThan(touchE4);
  });

  it("buys are capped above the touch the same way", () => {
    const plan = planMarketOrder({ ...base, side: "buy" });
    expect(plan.limitedBy).toBe("impact");
    expect(plan.lastPriceE4).toBeLessThanOrEqual(Math.ceil(touchE4 * 1.15) + 1);
    expect(plan.impactBps).toBeGreaterThan(0);
  });
});
