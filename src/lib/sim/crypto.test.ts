import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  actionSuccessBps,
  applyFlow,
  applyStats,
  buySlippageBps,
  coinAction,
  decayStats,
  discontinuePayoutCents,
  eventChanceBps,
  eventShock,
  isDead,
  isRugPull,
  launchPool,
  nextMemeCoin,
  pickRegime,
  playerCoinDriftDay,
  playerCoinSigmaDay,
  poolAt,
  poolPriceE4,
  regimeHours,
  rollCoinEvent,
  rollMarketEvent,
  sigmaTick,
  stableReturn,
  swapBuy,
  swapSell,
  tickReturn,
} from "./crypto.ts";

const event = (key: string) => BALANCE.crypto.events.find((e) => e.key === key)!;

describe("liquidity pool (ADR-101)", () => {
  it("prices the coin as cash per coin", () => {
    const pool = poolAt(1_000_000n, 10_000n); // 10.000 € at 1 €
    expect(pool.tokensE6).toBe(10_000_000_000n); // 10.000 coins
    expect(poolPriceE4(pool)).toBe(10_000n);
  });

  it("buying gives fewer coins the more is bought, and raises the price", () => {
    const pool = poolAt(1_000_000n, 10_000n);
    const small = swapBuy(pool, 10_000n, 0); // 100 €
    const big = swapBuy(pool, 500_000n, 0); // 5.000 €
    expect(Number(small.tokensOutE6) / 1e6).toBeCloseTo(99.0099, 3);
    expect(Number(big.tokensOutE6) / 1e6).toBeCloseTo(3_333.33, 1);
    expect(poolPriceE4(big.pool)).toBe(22_500n); // ×(1,5)²
  });

  it("keeps the fee in the pool and never pays out more than k allows", () => {
    const pool = poolAt(1_000_000n, 10_000n);
    const buy = swapBuy(pool, 100_000n, 100);
    expect(buy.feeCents).toBe(1_000n);
    expect(buy.pool.cashCents).toBe(1_100_000n);
    expect(buy.pool.cashCents * buy.pool.tokensE6).toBeGreaterThanOrEqual(pool.cashCents * pool.tokensE6);
    const back = swapSell(buy.pool, buy.tokensOutE6, 100);
    // Round trip loses the fees: less than the 1.000 € paid.
    expect(back.cashOutCents).toBeLessThan(100_000n);
    expect(back.cashOutCents).toBeGreaterThan(97_000n);
  });

  it("shows slippage: small pools move far more", () => {
    const deep = poolAt(100_000_000n, 10_000n);
    const shallow = poolAt(1_000_000n, 10_000n);
    // 1.000 € into a pool of 1 Mio. €: about 0,1 %.
    expect(buySlippageBps(deep, 100_000n, 0)).toBeLessThanOrEqual(10);
    expect(buySlippageBps(shallow, 100_000n, 0)).toBeGreaterThan(900);
  });

  it("moves the price by a log return through the market's flow", () => {
    const pool = poolAt(5_000_000n, 1_000n);
    const up = applyFlow(pool, Math.log(1.2));
    expect(Number(poolPriceE4(up))).toBeCloseTo(1_200, -1);
    const down = applyFlow(pool, Math.log(0.5));
    expect(Number(poolPriceE4(down))).toBeCloseTo(500, -1);
  });
});

describe("price moves", () => {
  it("scales the daily volatility to a tick", () => {
    expect(sigmaTick(0.4, 86_400)).toBeCloseTo(0.4);
    expect(sigmaTick(0.4, 5)).toBeCloseTo(0.4 * Math.sqrt(5 / 86_400));
  });

  it("follows the market with beta and drifts with the regime", () => {
    const meme = { sigmaDay: 0.4, beta: 1.6 };
    expect(tickReturn(meme, 0.03, 0, 0, 86_400)).toBeCloseTo(0.048);
    // Beta 1: only the market shock counts.
    const major = { sigmaDay: 0.06, beta: 1 };
    expect(tickReturn(major, 0, 1, 5, 86_400)).toBeCloseTo(0.06);
  });

  it("pulls stablecoins back to the peg", () => {
    const below = stableReturn(9_000, 10_000, 0.5, 0, 0, 3_600);
    expect(below).toBeGreaterThan(0);
    expect(Math.exp(below) * 9_000).toBeCloseTo(9_000 * Math.pow(10_000 / 9_000, 0.5), 0);
    expect(stableReturn(10_000, 10_000, 0.5, 0, 0, 5)).toBe(0);
  });

  it("chooses regimes by weight and lasts one to three days", () => {
    expect(pickRegime(0)).toBe("bull");
    expect(pickRegime(0.5)).toBe("flat");
    expect(pickRegime(0.99)).toBe("bear");
    expect(regimeHours(0)).toBe(24);
    expect(regimeHours(1)).toBe(72);
  });
});

describe("own coins", () => {
  it("launch: liquidity at the start price, the team keeps its share on top", () => {
    const l = launchPool(500_000n, 1_000n, 2_000);
    expect(l.pool.tokensE6).toBe(50_000_000_000n); // 50.000 coins at 0,10 €
    expect(l.teamTokensE6).toBe(12_500_000_000n);
    expect(Number((l.teamTokensE6 * 10_000n) / l.supplyE6)).toBe(2_000);
  });

  it("drifts with hype and utility, calms down with technology", () => {
    expect(playerCoinDriftDay({ tech: 0, hype: 0, utility: 0 })).toBeCloseTo(-0.06);
    expect(playerCoinDriftDay({ tech: 0, hype: 50, utility: 50 })).toBeCloseTo(0.08);
    expect(playerCoinSigmaDay(0)).toBeCloseTo(0.35);
    expect(playerCoinSigmaDay(100)).toBeCloseTo(0.175);
  });

  it("hype fades fast, utility slowly, technology stays", () => {
    const after = decayStats({ tech: 40, hype: 80, utility: 50 }, 24);
    expect(after.tech).toBe(40);
    expect(after.hype).toBeCloseTo(80 * 0.97 ** 24);
    expect(after.utility).toBeCloseTo(50 * 0.995 ** 24);
    expect(applyStats({ tech: 90, hype: 5, utility: 0 }, { tech: 35, hype: -10 })).toEqual({
      tech: 100,
      hype: 0,
      utility: 0,
    });
  });

  it("technical actions succeed more often with IT skills", () => {
    expect(actionSuccessBps(coinAction("smart_contract")!, 0)).toBe(5_000);
    expect(actionSuccessBps(coinAction("smart_contract")!, 6)).toBe(6_800);
    expect(actionSuccessBps(coinAction("audit")!, 0)).toBe(10_000);
  });

  it("counts a big sale of team tokens as a rug pull", () => {
    expect(isRugPull(2_000n, 10_000n)).toBe(false);
    expect(isRugPull(2_001n, 10_000n)).toBe(true);
  });

  it("pays out the pool by coins when a coin closes", () => {
    expect(discontinuePayoutCents(1_000_000n, 25n, 100n)).toBe(250_000n);
    expect(discontinuePayoutCents(1_000_000n, 25n, 0n)).toBe(0n);
  });
});

describe("events", () => {
  it("only hit their scope; own coins move the chance with their stats", () => {
    expect(eventChanceBps(event("depeg"), "meme", null)).toBe(0);
    expect(eventChanceBps(event("hack"), "alt", null)).toBe(20);
    expect(eventChanceBps(event("hack"), "player", { tech: 100, hype: 0, utility: 0 })).toBe(0);
    expect(eventChanceBps(event("hack"), "player", { tech: 0, hype: 0, utility: 0 })).toBe(30);
    expect(eventChanceBps(event("influencer"), "player", { tech: 0, hype: 100, utility: 0 })).toBe(90);
  });

  it("rolls at most one event per coin and hour", () => {
    expect(rollCoinEvent([0.99, 0.5], "major", null)).toBeNull();
    expect(rollCoinEvent([0, 0], "major", null)?.scope).toContain("major");
    expect(rollCoinEvent([0, 0], "stable", null)?.key).toBe("depeg");
    expect(rollMarketEvent([0.99, 0])).toBeNull();
    expect(rollMarketEvent([0, 0])?.key).toBe("meme_wave");
  });

  it("shocks within the range; algorithmic stablecoins lose their peg harder", () => {
    expect(eventShock(event("influencer"), 0)).toBeCloseTo(0.25);
    expect(eventShock(event("influencer"), 1)).toBeCloseTo(1.2);
    expect(eventShock(event("depeg"), 1, true)).toBeCloseTo(-0.06);
  });

  it("replaces dead meme coins with fresh names and tickers", () => {
    expect(isDead(2n)).toBe(true);
    expect(isDead(3n)).toBe(false);
    expect(nextMemeCoin(new Set(), new Set())).toEqual({ name: "Katzenkanone", ticker: "KTZ" });
    expect(nextMemeCoin(new Set(["Katzenkanone"]), new Set(["WRS"]))).toEqual({ name: "Wurstwal", ticker: "WUR" });
  });
});
