import { describe, expect, it } from "vitest";
import type { MyCompany } from "@/features/game/types";
import { coachAdvice, hourBreakdown } from "./coach";

const live: NonNullable<MyCompany["live"]> = {
  lastHourAt: "2026-11-12T10:00:00Z",
  revenuePerHourCents: 10_000,
  profitPerHourCents: 2_000,
  payFactorBps: 10_000,
  todayRevenueCents: 0,
  todayProfitCents: 0,
  quarterRevenueCents: 0,
  quarterProfitCents: 0,
  contractRevenuePerHourCents: 0,
  demandPerHourCents: 10_000,
  capacityPerHourCents: 50_000,
  fixedPerHourCents: 2_500,
  aiWagesPerHourCents: 0,
  marketingPerHourCents: 0,
};

const base = {
  live,
  contractWork: true,
  priceLevel: "normal" as const,
  qualityBps: 4_000,
  awarenessBps: 300,
  aiWorkers: 0,
  teamProductivityBps: 15_000,
  canUpgrade: false,
  canExpand: false,
  expansionCostCents: null,
  cashCents: 0,
  unpaidCents: 0,
  maxEmployees: 2,
  headcount: 0,
};

const tips = (input: Partial<typeof base> & { live?: typeof live }) =>
  coachAdvice({ ...base, ...input }, 10).map((a) => a.tip);

describe("profit coach (ADR-083)", () => {
  it("waits for the first hour", () => {
    expect(coachAdvice({ ...base, live: null })[0]!.tip).toBe("waiting");
  });

  it("asks to switch contract work on when capacity is idle", () => {
    expect(tips({ contractWork: false })).toContain("contractOff");
    expect(tips({ contractWork: true })).not.toContain("contractOff");
  });

  it("few customers: marketing and budget prices", () => {
    expect(tips({})).toEqual(expect.arrayContaining(["fewCustomers", "tryBudget"]));
    expect(tips({ priceLevel: "budget" } as never)).not.toContain("tryBudget");
  });

  it("idle AI workers are named first, they cost wages for nothing", () => {
    const advice = coachAdvice({ ...base, aiWorkers: 1, teamProductivityBps: 25_000 }, 3);
    expect(advice[0]!.tip).toBe("aiIdle");
    expect(advice[0]!.action).toBe("dismissAi");
  });

  it("sold out: hire, and premium once quality allows", () => {
    const full = { ...live, demandPerHourCents: 60_000 };
    expect(tips({ live: full, qualityBps: 7_000 })).toEqual(expect.arrayContaining(["soldOut", "tryPremium"]));
    expect(tips({ live: full, qualityBps: 3_000 })).not.toContain("tryPremium");
  });

  it("warns about premium without quality", () => {
    expect(tips({ priceLevel: "premium", qualityBps: 3_000 } as never)).toContain("premiumLowQuality");
  });

  it("losing to fixed costs is named", () => {
    expect(tips({ live: { ...live, revenuePerHourCents: 1_000, profitPerHourCents: -1_800 } })).toContain("fixedHigh");
  });

  it("profitable companies are pointed to growth", () => {
    expect(tips({ canExpand: true, expansionCostCents: 100, cashCents: 1_000 } as never)).toContain("expand");
    expect(tips({ canUpgrade: true })).toContain("upgrade");
  });

  it("warnings come before tips, tips before praise", () => {
    const advice = coachAdvice({ ...base, contractWork: false, canUpgrade: true }, 10);
    const tones = advice.map((a) => a.tone);
    expect(tones).toEqual(
      [...tones].sort((a, b) => ["warn", "tip", "good"].indexOf(a) - ["warn", "tip", "good"].indexOf(b)),
    );
  });

  it("the hour breakdown adds up to the profit", () => {
    const h = hourBreakdown({ ...live, contractRevenuePerHourCents: 3_000, marketingPerHourCents: 500 });
    expect(
      h.ownRevenueCents +
        h.contractRevenueCents -
        h.goodsAndWagesCents -
        h.aiWagesCents -
        h.fixedCents -
        h.marketingCents,
    ).toBe(h.profitCents);
  });
});
