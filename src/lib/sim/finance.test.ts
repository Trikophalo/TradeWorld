import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { bondCouponCents, bondPriceE4, bondValueCents, bondYieldBps } from "./bonds.ts";
import { annualizeGrowthBps, decidePolicyRate, isRateDecisionQuarter, moneyGrowthBps } from "./central-bank.ts";
import { creditLineCents, loanRateBps, loanRiskPremiumBps, quarterlyInterestCents } from "./loans.ts";
import {
  accruedFinancingCents,
  checkMargin,
  initialMarginCents,
  leverageFinancingRateBps,
  liquidationPriceE4,
  maxLeverageForLevel,
  shortBorrowRateBps,
} from "./margin.ts";
import { settleCapitalGainsTax, withholdingTaxCents } from "./tax.ts";
import { marketSession, secondsPerGameYear, ticksPerQuarter } from "./time.ts";
import { salaryAccruedCents, vaultAccruedCents, vaultStatus } from "./vault.ts";

const b = (n: number) => BigInt(n);
const HOUR = 3_600_000;

describe("bonds", () => {
  it("yields land between 2 % and 4 % and rise with maturity at the start rate", () => {
    const yields = BALANCE.bonds.maturities.map((m) => bondYieldBps(300, m.years));
    expect(yields).toEqual([225, 250, 290, 325]);
  });

  it("follows the policy rate inside the corridor and clamps outside", () => {
    expect(bondYieldBps(350, 5)).toBe(340);
    for (const rate of [0, 50, 300, 600, 1000]) {
      for (const m of BALANCE.bonds.maturities) {
        const y = bondYieldBps(rate, m.years);
        expect(y).toBeGreaterThanOrEqual(200);
        expect(y).toBeLessThanOrEqual(400);
      }
    }
  });

  it("interpolates unknown maturities", () => {
    expect(bondYieldBps(300, 3.5)).toBe(270);
    expect(bondYieldBps(300, 0.5)).toBe(225);
    expect(bondYieldBps(300, 30)).toBe(325);
  });

  it("pays a quarter of the annual coupon per quarter", () => {
    // 10 000 EUR nominal at 3 % -> 300 EUR per game year -> 75 EUR per quarter
    expect(bondCouponCents(b(1_000_000), 300)).toBe(b(7_500));
  });

  it("prices at par when coupon equals yield, below par when yields rose", () => {
    expect(bondPriceE4(300, 300, 20)).toBe(b(1_000_000));
    expect(bondPriceE4(300, 400, 20) < b(1_000_000)).toBe(true);
    expect(bondPriceE4(300, 200, 20) > b(1_000_000)).toBe(true);
    expect(bondPriceE4(300, 400, 0)).toBe(b(1_000_000));
    // Longer bonds react more strongly to the same yield change.
    expect(bondPriceE4(300, 400, 40) < bondPriceE4(300, 400, 4)).toBe(true);
    expect(bondValueCents(b(1_000_000), b(985_000))).toBe(b(985_000));
  });
});

describe("loans", () => {
  const base = {
    policyRateBps: 300,
    reputation: 50,
    debtCents: b(5_000_000),
    equityCents: b(10_000_000),
    trailingOperatingProfitCents: b(2_000_000),
    cfoSkill: 0,
  };

  it("rate = policy rate + risk premium", () => {
    const { rateBps, riskPremiumBps } = loanRateBps(base);
    expect(rateBps).toBe(300 + riskPremiumBps);
    expect(riskPremiumBps).toBe(loanRiskPremiumBps(base));
    expect(riskPremiumBps).toBeGreaterThanOrEqual(BALANCE.loans.minPremiumBps);
  });

  it("moves one-to-one with the policy rate", () => {
    // Small debt so that the coverage discount is capped in both cases.
    const small = { ...base, debtCents: b(100_000) };
    expect(loanRateBps({ ...small, policyRateBps: 500 }).rateBps - loanRateBps(small).rateBps).toBe(200);
  });

  it("rewards reputation, low leverage, profit and a CFO", () => {
    const premium = loanRiskPremiumBps(base);
    expect(loanRiskPremiumBps({ ...base, reputation: 90 })).toBeLessThan(premium);
    expect(loanRiskPremiumBps({ ...base, reputation: 10 })).toBeGreaterThan(premium);
    expect(loanRiskPremiumBps({ ...base, debtCents: b(30_000_000) })).toBeGreaterThan(premium);
    expect(loanRiskPremiumBps({ ...base, trailingOperatingProfitCents: b(-1) })).toBeGreaterThan(premium);
    expect(loanRiskPremiumBps({ ...base, cfoSkill: 8 })).toBe(premium - 80);
  });

  it("stays inside the premium bounds in extreme cases", () => {
    const worst = loanRiskPremiumBps({
      ...base,
      reputation: 0,
      equityCents: b(-1),
      trailingOperatingProfitCents: b(-1),
    });
    expect(worst).toBeLessThanOrEqual(BALANCE.loans.maxPremiumBps);
    const best = loanRiskPremiumBps({ ...base, reputation: 100, debtCents: b(0), cfoSkill: 10 });
    expect(best).toBe(BALANCE.loans.minPremiumBps);
  });

  it("charges a quarter of the annual interest per quarter", () => {
    expect(quarterlyInterestCents(b(10_000_000), 800)).toBe(b(200_000));
    expect(quarterlyInterestCents(b(0), 800)).toBe(b(0));
  });

  it("derives the credit line from level and reputation", () => {
    expect(creditLineCents(14, 100)).toBe(b(0));
    expect(creditLineCents(15, 50)).toBe(b(5_000_000));
    expect(creditLineCents(20, 50)).toBe(b(25_000_000));
    expect(creditLineCents(25, 0)).toBe(b(100_000_000));
    expect(creditLineCents(50, 100)).toBe(b(300_000_000));
  });
});

describe("capital gains tax", () => {
  it("taxes gains at 25 %", () => {
    expect(settleCapitalGainsTax(b(100_000), b(0))).toEqual({
      taxCents: b(25_000),
      lossCarryForwardCents: b(0),
      offsetCents: b(0),
    });
  });

  it("collects losses without refund", () => {
    expect(settleCapitalGainsTax(b(-40_000), b(10_000))).toEqual({
      taxCents: b(0),
      lossCarryForwardCents: b(50_000),
      offsetCents: b(0),
    });
  });

  it("offsets gains against earlier losses", () => {
    expect(settleCapitalGainsTax(b(30_000), b(50_000))).toEqual({
      taxCents: b(0),
      lossCarryForwardCents: b(20_000),
      offsetCents: b(30_000),
    });
    expect(settleCapitalGainsTax(b(70_000), b(50_000))).toEqual({
      taxCents: b(5_000),
      lossCarryForwardCents: b(0),
      offsetCents: b(50_000),
    });
  });

  it("over a sequence taxes exactly the net gain (if it ends positive)", () => {
    const pnls = [-300, 500, -100, 400, -50, 250].map((x) => b(x * 100));
    let pot = b(0);
    let tax = b(0);
    for (const pnl of pnls) {
      const s = settleCapitalGainsTax(pnl, pot);
      pot = s.lossCarryForwardCents;
      tax += s.taxCents;
    }
    // Net +700 EUR, but the last loss of 50 is not offset by a later gain of 250? It is: pot 50 -> taxable 200.
    expect(tax).toBe(b(17_500));
    expect(pot).toBe(b(0));
  });

  it("never returns negative tax and handles zero", () => {
    expect(settleCapitalGainsTax(b(0), b(0)).taxCents).toBe(b(0));
    expect(settleCapitalGainsTax(b(1), b(0)).taxCents).toBe(b(0)); // 0.25 cent rounds to 0
    expect(withholdingTaxCents(b(10_000))).toBe(b(2_500));
    expect(withholdingTaxCents(b(-10_000))).toBe(b(0));
  });
});

describe("margin and liquidation", () => {
  const entry = b(1_000_000); // 100 EUR

  it("limits leverage by level", () => {
    expect(maxLeverageForLevel(1)).toBe(1);
    expect(maxLeverageForLevel(11)).toBe(1);
    expect(maxLeverageForLevel(12)).toBe(2);
    expect(maxLeverageForLevel(18)).toBe(5);
    expect(maxLeverageForLevel(29)).toBe(5);
    expect(maxLeverageForLevel(30)).toBe(10);
  });

  it("computes the initial margin", () => {
    expect(initialMarginCents(b(10), entry, 5)).toBe(b(20_000));
    expect(() => initialMarginCents(b(10), entry, 0)).toThrow(RangeError);
  });

  it("an unlevered long cannot be liquidated", () => {
    expect(liquidationPriceE4("long", entry, 1)).toBeNull();
  });

  it("long: entry x (1 - 1/L) / (1 - m)", () => {
    // 2x: 100 x 0.5 / 0.95 = 52.6316
    expect(liquidationPriceE4("long", entry, 2)).toBe(b(526_316));
    // 10x: 100 x 0.9 / 0.95 = 94.7369 (rounded up)
    expect(liquidationPriceE4("long", entry, 10)).toBe(b(947_369));
  });

  it("short: entry x (1 + 1/L) / (1 + m)", () => {
    // 1x: 100 x 2 / 1.05 = 190.4761 (rounded down)
    expect(liquidationPriceE4("short", entry, 1)).toBe(b(1_904_761));
    // 5x: 100 x 1.2 / 1.05 = 114.2857
    expect(liquidationPriceE4("short", entry, 5)).toBe(b(1_142_857));
  });

  it("higher leverage liquidates closer to the entry", () => {
    const longs = [2, 5, 10].map((l) => liquidationPriceE4("long", entry, l) as bigint);
    expect(longs[0]! < longs[1]! && longs[1]! < longs[2]! && longs[2]! < entry).toBe(true);
    const shorts = [1, 2, 5, 10].map((l) => liquidationPriceE4("short", entry, l) as bigint);
    expect(shorts[0]! > shorts[1]! && shorts[1]! > shorts[2]! && shorts[2]! > shorts[3]! && shorts[3]! > entry).toBe(
      true,
    );
  });

  it("accrued costs move the liquidation price towards the market", () => {
    const clean = liquidationPriceE4("long", entry, 5) as bigint;
    const withCosts = liquidationPriceE4("long", entry, 5, 500, b(20_000)) as bigint;
    expect(withCosts > clean).toBe(true);
    const shortClean = liquidationPriceE4("short", entry, 5) as bigint;
    const shortCosts = liquidationPriceE4("short", entry, 5, 500, b(20_000)) as bigint;
    expect(shortCosts < shortClean).toBe(true);
  });

  it("checkMargin agrees with the liquidation price", () => {
    for (const leverage of [2, 5, 10]) {
      const liq = liquidationPriceE4("long", entry, leverage) as bigint;
      expect(checkMargin("long", b(100), entry, leverage, liq).status).toBe("liquidation");
      expect(checkMargin("long", b(100), entry, leverage, liq + b(2_000)).status).not.toBe("liquidation");
    }
    for (const leverage of [1, 2, 5, 10]) {
      const liq = liquidationPriceE4("short", entry, leverage) as bigint;
      expect(checkMargin("short", b(100), entry, leverage, liq).status).toBe("liquidation");
      expect(checkMargin("short", b(100), entry, leverage, liq - b(2_000)).status).not.toBe("liquidation");
    }
  });

  it("warns before liquidating and reports equity", () => {
    const fresh = checkMargin("long", b(100), entry, 5, entry);
    expect(fresh).toMatchObject({
      equityCents: b(200_000),
      notionalCents: b(1_000_000),
      marginBps: 2000,
      status: "ok",
    });
    expect(checkMargin("long", b(100), entry, 5, b(860_000)).status).toBe("margin_call");
    expect(checkMargin("long", b(100), entry, 1, b(1)).status).toBe("ok");
    expect(checkMargin("short", b(100), entry, 2, b(1_200_000)).equityCents).toBe(b(300_000));
  });

  it("accrues financing pro rata by the second", () => {
    const year = secondsPerGameYear();
    expect(year).toBe(86_400);
    expect(leverageFinancingRateBps(300)).toBe(700);
    expect(shortBorrowRateBps("penny")).toBe(1000);
    // 10 000 EUR borrowed at 7 % per game year = 700 EUR per day, 175 EUR per quarter.
    expect(accruedFinancingCents(b(1_000_000), 700, year, year)).toBe(b(70_000));
    expect(accruedFinancingCents(b(1_000_000), 700, year / 4, year)).toBe(b(17_500));
    expect(accruedFinancingCents(b(1_000_000), 700, 1, year)).toBe(b(1)); // rounded up
    expect(accruedFinancingCents(b(1_000_000), 700, 0, year)).toBe(b(0));
  });
});

describe("vault", () => {
  it("accrues 100 EUR per hour", () => {
    expect(vaultAccruedCents(0, HOUR)).toBe(b(10_000));
    expect(vaultAccruedCents(0, 90 * 60_000)).toBe(b(15_000));
    expect(vaultAccruedCents(0, 1_000)).toBe(b(2)); // 2.77 cents rounded down
  });

  it("caps at 8 hours", () => {
    expect(vaultAccruedCents(0, 8 * HOUR)).toBe(b(80_000));
    expect(vaultAccruedCents(0, 100 * HOUR)).toBe(b(80_000));
    const status = vaultStatus(0, 9 * HOUR);
    expect(status).toMatchObject({ isFull: true, msUntilFull: 0, capCents: b(80_000) });
  });

  it("handles clock skew and reports time until full", () => {
    expect(vaultAccruedCents(HOUR, 0)).toBe(b(0));
    expect(vaultStatus(0, 2 * HOUR)).toMatchObject({ isFull: false, msUntilFull: 6 * HOUR });
  });

  it("pays salary for at most 12 hours per day", () => {
    const rate = b(30_000);
    expect(salaryAccruedCents(rate, 2 * HOUR, 0)).toEqual({ cents: b(60_000), paidMs: 2 * HOUR });
    expect(salaryAccruedCents(rate, 5 * HOUR, 10 * HOUR)).toEqual({ cents: b(60_000), paidMs: 2 * HOUR });
    expect(salaryAccruedCents(rate, 5 * HOUR, 12 * HOUR)).toEqual({ cents: b(0), paidMs: 0 });
  });
});

describe("central bank", () => {
  it("measures money growth per active player", () => {
    const before = { moneySupplyCents: b(4_000_000), activePlayers: 4 };
    expect(moneyGrowthBps(before, { moneySupplyCents: b(4_400_000), activePlayers: 4 })).toBe(1000);
    // A fifth player joining with the same average wealth is not inflation.
    expect(moneyGrowthBps(before, { moneySupplyCents: b(5_000_000), activePlayers: 5 })).toBe(0);
    expect(moneyGrowthBps({ moneySupplyCents: b(0), activePlayers: 4 }, before)).toBe(0);
  });

  it("annualizes growth", () => {
    expect(annualizeGrowthBps(100, 1)).toBe(406);
    expect(annualizeGrowthBps(400, 4)).toBe(400);
    expect(annualizeGrowthBps(100, 0)).toBe(0);
  });

  it("holds inside the tolerance band at the neutral rate", () => {
    expect(decidePolicyRate(300, 400)).toMatchObject({ newRateBps: 300, direction: "hold" });
    expect(decidePolicyRate(300, 599)).toMatchObject({ newRateBps: 300, direction: "hold" });
    expect(decidePolicyRate(300, 201)).toMatchObject({ newRateBps: 300, direction: "hold" });
  });

  it("hikes when money grows too fast and cuts when it shrinks", () => {
    expect(decidePolicyRate(300, 600)).toMatchObject({ newRateBps: 325, direction: "hike", changeBps: 25 });
    expect(decidePolicyRate(300, 5000)).toMatchObject({ newRateBps: 350, direction: "hike" });
    expect(decidePolicyRate(300, 100)).toMatchObject({ newRateBps: 275, direction: "cut" });
    expect(decidePolicyRate(300, -5000)).toMatchObject({ newRateBps: 250, direction: "cut" });
  });

  it("respects the bounds", () => {
    expect(decidePolicyRate(1000, 5000).newRateBps).toBe(1000);
    expect(decidePolicyRate(50, -5000).newRateBps).toBe(50);
    expect(decidePolicyRate(990, 5000).newRateBps).toBe(1000);
  });

  it("drifts back to neutral inside the band without overshooting", () => {
    expect(decidePolicyRate(400, 400).newRateBps).toBe(375);
    expect(decidePolicyRate(200, 400).newRateBps).toBe(225);
    expect(decidePolicyRate(310, 400).newRateBps).toBe(300);
    expect(decidePolicyRate(290, 400).newRateBps).toBe(300);
  });

  it("is monotone in money growth", () => {
    let last = -Infinity;
    for (let g = -2000; g <= 3000; g += 50) {
      const rate = decidePolicyRate(300, g).newRateBps;
      expect(rate).toBeGreaterThanOrEqual(last);
      last = rate;
    }
  });

  it("schedules one decision per game year", () => {
    const due = [0, 1, 2, 3, 4, 5, 6, 7].filter((q) => isRateDecisionQuarter(q));
    expect(due).toEqual([3, 7]);
  });
});

describe("time", () => {
  it("knows the market hours", () => {
    expect(marketSession(7.99)).toBe("after_hours");
    expect(marketSession(8)).toBe("open");
    expect(marketSession(21.99)).toBe("open");
    expect(marketSession(22)).toBe("after_hours");
    expect(marketSession(2)).toBe("after_hours");
  });

  it("derives tick counts", () => {
    expect(ticksPerQuarter()).toBe(4320);
  });
});
