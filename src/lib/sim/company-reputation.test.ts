import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  REPUTATION_DRIVERS,
  reputationDemandFactor,
  reputationDrivers,
  reputationStep,
  reputationTargetAll,
  type ReputationHour,
} from "./company-reputation.ts";
import { reputationTarget } from "./listed.ts";

const cfg = BALANCE.companyHealth.reputation;
const calm: ReputationHour = {
  quality: 0.4,
  demandCents: 10_000,
  capacityCents: 12_000,
  priceLevel: "normal",
  payFactorBps: 10_000,
  unpaidCents: 0,
  crisisSeverity: 0,
  campaign: false,
};

describe("company reputation (ADR-183)", () => {
  it("is neutral for an average, calm hour", () => {
    const d = reputationDrivers(calm, cfg);
    for (const k of REPUTATION_DRIVERS) expect(d[k]).toBeCloseTo(0);
    expect(reputationTargetAll(d, null, cfg)).toBe(cfg.base);
  });

  it("rewards quality, fair prices and campaigns", () => {
    const d = reputationDrivers({ ...calm, quality: 1, priceLevel: "budget", campaign: true }, cfg);
    expect(d.quality).toBeCloseTo(cfg.qualityMax);
    expect(d.price).toBe(cfg.budgetGain);
    expect(d.campaign).toBe(cfg.campaignGain);
    expect(reputationTargetAll(d, null, cfg)).toBeCloseTo(
      cfg.base + cfg.qualityMax + cfg.budgetGain + cfg.campaignGain,
    );
  });

  it("punishes poor quality, sold out hours, unpaid wages, bills and crises", () => {
    const d = reputationDrivers(
      {
        ...calm,
        quality: 0,
        demandCents: 10_000,
        capacityCents: 5_000,
        payFactorBps: 5_000,
        unpaidCents: 1,
        crisisSeverity: 2,
      },
      cfg,
    );
    expect(d.quality).toBeCloseTo(-cfg.qualityMaxLoss);
    expect(d.delivery).toBeCloseTo(-cfg.deliveryMaxLoss / 2);
    expect(d.wages).toBeCloseTo(-cfg.wagesMaxLoss / 2);
    expect(d.bills).toBe(-cfg.billsLoss);
    expect(d.crisis).toBe(-2 * cfg.crisisPerSeverity);
  });

  it("calls premium below the quality minimum a rip-off", () => {
    expect(reputationDrivers({ ...calm, priceLevel: "premium", quality: 0.4 }, cfg).price).toBe(
      -cfg.premiumLowQualityLoss,
    );
    expect(reputationDrivers({ ...calm, priceLevel: "premium", quality: 0.8 }, cfg).price).toBe(0);
  });

  it("no demand is nothing to judge for delivery", () => {
    expect(reputationDrivers({ ...calm, demandCents: 0, capacityCents: 0 }, cfg).delivery).toBeCloseTo(0);
  });

  it("adds the operational drivers to a listed company's target and clamps 0..100", () => {
    const listed = reputationTarget({
      itemPoints: 0,
      payoutCents: 0,
      profitCents: 1_000,
      revenueCents: 5_000,
      investedCents: 0,
      dividendCents: 0,
      dividendStreak: 0,
      scandal: false,
    });
    const d = reputationDrivers({ ...calm, quality: 1 }, cfg);
    expect(reputationTargetAll(d, listed.target, cfg)).toBeCloseTo(listed.target + cfg.qualityMax);
    expect(reputationTargetAll({ ...d, quality: 200 }, 90, cfg)).toBe(100);
    expect(reputationTargetAll({ ...d, quality: -200 }, 10, cfg)).toBe(0);
  });

  it("moves a step toward the target each hour", () => {
    expect(reputationStep(50, 60, cfg.adjustPerHour)).toBeCloseTo(50.8);
    let v = 50;
    for (let i = 0; i < 48; i++) v = reputationStep(v, 60, cfg.adjustPerHour);
    expect(v).toBeGreaterThan(59);
    expect(reputationStep(0, -10, 1)).toBe(0);
  });

  it("moves the demand by at most demandMaxEffect", () => {
    expect(reputationDemandFactor(50, cfg)).toBe(1);
    expect(reputationDemandFactor(100, cfg)).toBeCloseTo(1 + cfg.demandMaxEffect);
    expect(reputationDemandFactor(0, cfg)).toBeCloseTo(1 - cfg.demandMaxEffect);
    expect(reputationDemandFactor(150, cfg)).toBeCloseTo(1 + cfg.demandMaxEffect);
  });
});
