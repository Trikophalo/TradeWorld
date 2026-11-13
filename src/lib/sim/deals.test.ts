import { describe, expect, it } from "vitest";
import {
  dealSizeLimitCents,
  loanCollect,
  loanDueCents,
  loanPhase,
  loanTermsError,
  maxLoanPrincipalCents,
  stakePayoutCents,
  stakeTermsError,
  supplyFeeSplit,
  supplyFreeCapacityCents,
  supplyHour,
  supplyKept,
  supplyMargins,
  supplyMaxCostCents,
  supplyPrepayCents,
  supplyTermsError,
  trustBand,
  trustOnEnd,
  trustScore,
  unmetDemandCents,
} from "./deals.ts";

const H = 3_600_000;

describe("loans", () => {
  it("check the terms; the amount grows with the lender's level", () => {
    expect(maxLoanPrincipalCents(4)).toBe(8_000_000);
    expect(loanTermsError({ principalCents: 5_000_000, interestBps: 800, hours: 168 }, 4)).toBeNull();
    expect(loanTermsError({ principalCents: 9_000_000, interestBps: 800, hours: 168 }, 4)).toBe("amount");
    expect(loanTermsError({ principalCents: 9_999, interestBps: 800, hours: 168 }, 4)).toBe("amount");
    expect(loanTermsError({ principalCents: 50_000, interestBps: 3_001, hours: 168 }, 4)).toBe("interest");
    expect(loanTermsError({ principalCents: 50_000, interestBps: 0, hours: 23 }, 4)).toBe("hours");
  });

  it("owe principal plus interest for the whole term", () => {
    expect(loanDueCents(5_000_000n, 800)).toBe(5_400_000n);
    // 1.234,5 cents of interest round half to even.
    expect(loanDueCents(12_345n, 1_000)).toBe(13_579n);
  });

  it("collect what the free cash allows", () => {
    expect(loanCollect(1_000n, 5_000n)).toEqual({ paidCents: 1_000n, leftCents: 0n });
    expect(loanCollect(1_000n, 300n)).toEqual({ paidCents: 300n, leftCents: 700n });
    expect(loanCollect(1_000n, -50n)).toEqual({ paidCents: 0n, leftCents: 1_000n });
  });

  it("are overdue after the due date and defaulted a week later", () => {
    expect(loanPhase(10 * H, 9 * H)).toBe("running");
    expect(loanPhase(10 * H, 10 * H)).toBe("overdue");
    expect(loanPhase(10 * H, 177 * H)).toBe("overdue");
    expect(loanPhase(10 * H, 178 * H)).toBe("defaulted");
  });
});

describe("supply contracts", () => {
  it("check the terms", () => {
    const ok = { volumeCentsPerHour: 50_000, feeBps: 6_000, prepayBps: 2_000, hours: 72 };
    expect(supplyTermsError(ok)).toBeNull();
    expect(supplyTermsError({ ...ok, volumeCentsPerHour: 999 })).toBe("volume");
    expect(supplyTermsError({ ...ok, feeBps: 9_600 })).toBe("fee");
    expect(supplyTermsError({ ...ok, prepayBps: 5_001 })).toBe("prepay");
    expect(supplyTermsError({ ...ok, hours: 400 })).toBe("hours");
  });

  it("use the supplier's free capacity, minus the anonymous contract work", () => {
    expect(supplyFreeCapacityCents(100_000, 60_000, false)).toBe(40_000);
    expect(supplyFreeCapacityCents(100_000, 60_000, true)).toBe(30_000);
    expect(supplyFreeCapacityCents(50_000, 60_000, true)).toBe(0);
    expect(unmetDemandCents(50_000, 60_000)).toBe(10_000);
    expect(unmetDemandCents(80_000, 60_000)).toBe(0);
  });

  it("deliver what the buyer misses, up to the volume and the supplier's free capacity", () => {
    const hour = supplyHour({
      volumeCentsPerHour: 20_000,
      feeBps: 6_000,
      buyerUnmetCents: 15_000,
      supplierFreeCents: 40_000,
      buyerPrice: 1.3,
      supplierGrossMargin: 0.75,
    });
    expect(hour).toEqual({
      deliveredCents: 15_000n,
      neededCents: 15_000n,
      buyerRevenueCents: 19_500n,
      feeCents: 9_000n,
      supplierGoodsCents: 3_750n,
    });
    const short = supplyHour({
      volumeCentsPerHour: 20_000,
      feeBps: 6_000,
      buyerUnmetCents: 30_000,
      supplierFreeCents: 5_000,
      buyerPrice: 1,
      supplierGrossMargin: 0.35,
    });
    expect(short.neededCents).toBe(20_000n);
    expect(short.deliveredCents).toBe(5_000n);
  });

  it("cost at most the full volume every hour; the prepayment is a share of that", () => {
    const t = { volumeCentsPerHour: 10_000, feeBps: 5_000, prepayBps: 2_000, hours: 48 };
    expect(supplyMaxCostCents(t)).toBe(240_000n);
    expect(supplyPrepayCents(t)).toBe(48_000n);
  });

  it("pay fees from the prepayment first", () => {
    expect(supplyFeeSplit(1_000n, 600n)).toEqual({ fromPrepay: 600n, fromCash: 400n });
    expect(supplyFeeSplit(1_000n, 0n)).toEqual({ fromPrepay: 0n, fromCash: 1_000n });
  });

  it("count as kept when at least half of what was needed came", () => {
    expect(supplyKept(5_000n, 10_000n)).toBe(true);
    expect(supplyKept(4_999n, 10_000n)).toBe(false);
    expect(supplyKept(0n, 0n)).toBe(true);
  });

  it("show both margins for a fee", () => {
    const m = supplyMargins(6_000, 1, 0.35);
    expect(m.buyer).toBeCloseTo(0.4);
    expect(m.supplier).toBeCloseTo(-0.05);
  });
});

describe("stakes", () => {
  it("check the terms and the company's total", () => {
    const ok = { amountCents: 100_000, shareBps: 2_000, hours: 168 };
    expect(stakeTermsError(ok)).toBeNull();
    expect(stakeTermsError(ok, 3_000)).toBeNull();
    expect(stakeTermsError(ok, 3_001)).toBe("share");
    expect(stakeTermsError({ ...ok, shareBps: 3_001 })).toBe("share");
    expect(stakeTermsError({ ...ok, amountCents: 9_999 })).toBe("amount");
  });

  it("pay a share of profitable hours only, never more than the free cash", () => {
    expect(stakePayoutCents(10_000n, 2_000, 99_999n)).toBe(2_000n);
    expect(stakePayoutCents(10_001n, 2_000, 99_999n)).toBe(2_000n);
    expect(stakePayoutCents(10_000n, 2_000, 500n)).toBe(500n);
    expect(stakePayoutCents(-10_000n, 2_000, 99_999n)).toBe(0n);
  });
});

describe("trust", () => {
  it("starts at 50 and stays between 0 and 100", () => {
    expect(trustScore([])).toBe(50);
    expect(trustScore([4, 3, -12])).toBe(45);
    expect(trustScore([-40, -40])).toBe(0);
    expect(trustScore([30, 30])).toBe(100);
  });

  it("names bands", () => {
    expect(trustBand(0)).toBe("risky");
    expect(trustBand(30)).toBe("shaky");
    expect(trustBand(50)).toBe("blank");
    expect(trustBand(60)).toBe("reliable");
    expect(trustBand(95)).toBe("rock");
  });

  it("moves for kept and broken deals", () => {
    expect(trustOnEnd("loan", "kept")).toEqual({ obligor: 4, other: 1 });
    expect(trustOnEnd("loan", "late")).toEqual({ obligor: 2, other: 1 });
    expect(trustOnEnd("loan", "forgiven")).toEqual({ obligor: 0, other: 3 });
    expect(trustOnEnd("supply", "kept")).toEqual({ obligor: 3, other: 3 });
    expect(trustOnEnd("supply", "short")).toEqual({ obligor: -4, other: 3 });
    expect(trustOnEnd("stake", "kept")).toEqual({ obligor: 3, other: 0 });
    expect(trustOnEnd("stake", "broken")).toEqual({ obligor: -12, other: 0 });
  });
});

describe("deal size grows with the company (ADR-100)", () => {
  it("is half the company value, at least 50.000 €", () => {
    expect(dealSizeLimitCents(0)).toBe(5_000_000);
    expect(dealSizeLimitCents(4_000_000)).toBe(5_000_000);
    expect(dealSizeLimitCents(30_000_000)).toBe(15_000_000);
  });
});
