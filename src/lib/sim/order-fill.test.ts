import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { type FillPlanInput, moveIntegral, planMarketOrder, stockSlope } from "./order-fill.ts";

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
  maxMoveBps: BALANCE.trading.maxTickReturnBps,
  bandLowE4: null,
  bandHighE4: null,
  minPriceE4: 1,
};

describe("planMarketOrder (ADR-189)", () => {
  it("the old unbounded linear path reproduces the half-price fill of the bug report", () => {
    const plan = planMarketOrder({ ...base, maxMoveBps: 1_000_000 });
    expect(plan.avgPriceE4).toBeGreaterThan(8_400);
    expect(plan.avgPriceE4).toBeLessThan(8_600);
  });

  it("the owner's sale now fills completely at a fair price", () => {
    const plan = planMarketOrder(base);
    expect(plan.quantityE6).toBe(base.quantityE6);
    const a = slope * 58_877.583251;
    expect(plan.avgPriceE4).toBe(Math.round(touchE4 * (1 - (0.1 * a - 0.005) / a)));
    expect(plan.grossCents).toBeGreaterThan(8_600_000);
    expect(plan.impactBps).toBe(-1000);
    expect(plan.netCents).toBe(plan.grossCents - 100);
  });

  it("small orders keep the ADR-126 half move", () => {
    const plan = planMarketOrder({ ...base, quantityE6: 1_000_000_000 });
    expect(plan.avgPriceE4).toBe(Math.round(touchE4 * (1 - slope * 500)));
  });

  it("no size limit: 1 million euros fill, never further than one tick can move", () => {
    const buy = planMarketOrder({ ...base, side: "buy", quantityE6: null, amountCents: 100_000_000 });
    expect(buy.netCents).toBeLessThanOrEqual(100_000_000);
    expect(buy.netCents).toBeGreaterThan(99_999_000);
    expect(buy.avgPriceE4).toBeLessThanOrEqual(Math.ceil(touchE4 * 1.1));
    const sell = planMarketOrder({ ...base, quantityE6: buy.quantityE6 });
    expect(sell.avgPriceE4).toBeGreaterThanOrEqual(Math.floor(touchE4 * 0.9));
  });

  it("a round trip never earns the own move", () => {
    const buy = planMarketOrder({ ...base, side: "buy", quantityE6: 100_000_000_000 });
    // the next tick moves the price at most maxMove up; selling everything then
    const after = Math.round(touchE4 * (1 + base.maxMoveBps / 10_000));
    const sell = planMarketOrder({
      ...base,
      touchE4: after,
      slope: (slope * after) / touchE4,
      quantityE6: buy.quantityE6,
    });
    expect(sell.netCents).toBeLessThan(buy.netCents);
  });

  it("the daily band is never crossed, the order still fills", () => {
    const plan = planMarketOrder({ ...base, bandLowE4: 15_500 });
    expect(plan.quantityE6).toBe(base.quantityE6);
    expect(plan.avgPriceE4).toBe(15_500);
    expect(plan.lastPriceE4).toBe(15_500);
  });

  it("amount sells get at least the amount", () => {
    const sell = planMarketOrder({ ...base, quantityE6: null, amountCents: 1_000_000 });
    expect(sell.grossCents).toBeGreaterThanOrEqual(1_000_000);
    expect(sell.grossCents - 1_000_000).toBeLessThanOrEqual(2);
  });

  it("moveIntegral saturates", () => {
    expect(moveIntegral(10, 0.01, 0.1)).toBeCloseTo(0.5);
    expect(moveIntegral(20, 0.01, 0.1)).toBeCloseTo(1.5);
  });
});
