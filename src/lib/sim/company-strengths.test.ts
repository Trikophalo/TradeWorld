import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  EMPTY_STRENGTHS,
  companyHealthPayFactor,
  strengthsBonusCents,
  strengthsInstant,
  strengthsNextReward,
  strengthsOverall,
  strengthsRewardBps,
  strengthsStep,
  type StrengthScores,
} from "./company-strengths.ts";

const cfg = BALANCE.companyHealth.strengths;
const goodHour = {
  awareness: 1,
  quality: 1,
  demandCents: 10_000,
  capacityCents: 12_000,
  revenueCents: 10_000,
  profitCents: 3_000,
  payFactorBps: 10_000,
  cashCents: 10_000_000,
  unpaidCents: 0,
};
const at = (v: number): StrengthScores => ({ awareness: v, quality: v, delivery: v, margin: v, team: v, finance: v });

describe("company strengths (ADR-176)", () => {
  it("rates an hour 0..100 per point", () => {
    expect(strengthsInstant(goodHour, cfg)).toEqual(at(100));
    const bad = strengthsInstant(
      {
        ...goodHour,
        awareness: 0.3,
        quality: 0.5,
        capacityCents: 5_000,
        profitCents: 1_000,
        payFactorBps: 8_000,
        unpaidCents: 1,
      },
      cfg,
    );
    expect(bad.awareness).toBeCloseTo(30);
    expect(bad.delivery).toBe(50);
    expect(bad.margin).toBeCloseTo(40); // 10 % margin of 25 % = full
    expect(bad.team).toBe(80);
    expect(bad.finance).toBe(0);
    expect(strengthsInstant({ ...goodHour, demandCents: 0, revenueCents: 0, profitCents: -500 }, cfg).delivery).toBe(
      50,
    );
  });

  it("grows slowly: perfect hours need days to reach the top tier, neglect falls faster", () => {
    let s: StrengthScores = EMPTY_STRENGTHS;
    const perfect = strengthsInstant(goodHour, cfg);
    let hours = 0;
    while (strengthsRewardBps(s, cfg) < 1_500) {
      s = strengthsStep(s, perfect, cfg);
      hours += 1;
    }
    expect(hours).toBeGreaterThan(24 * 7);
    expect(strengthsOverall(strengthsStep(EMPTY_STRENGTHS, perfect, cfg))).toBeCloseTo(2);
    const down = strengthsStep(s, EMPTY_STRENGTHS, cfg);
    expect(strengthsOverall(s) - strengthsOverall(down)).toBeGreaterThan(4);
  });

  it("pays tiered rewards and a pay factor for other features", () => {
    expect(strengthsRewardBps(at(49.9), cfg)).toBe(0);
    expect(strengthsRewardBps(at(50), cfg)).toBe(200);
    expect(strengthsRewardBps(at(80), cfg)).toBe(500);
    expect(strengthsRewardBps(at(95), cfg)).toBe(1_000);
    expect(strengthsRewardBps(at(100), cfg)).toBe(1_500);
    expect(strengthsNextReward(at(60), cfg)).toEqual({ at: 75, bps: 500 });
    expect(strengthsNextReward(at(100), cfg)).toBeNull();
    expect(companyHealthPayFactor(at(100))).toBeCloseTo(1.15);
    expect(strengthsBonusCents(12_345, 500)).toBe(617);
  });

  it("SQL: the same step as company_strengths_step (b5_company_bugs2.sql)", () => {
    const s = strengthsStep(
      { awareness: 40, quality: 60, delivery: 50, margin: 10, team: 100, finance: 80 },
      { awareness: 90, quality: 20, delivery: 50, margin: 100, team: 100, finance: 0 },
      cfg,
    );
    expect(s.awareness).toBeCloseTo(41);
    expect(s.quality).toBeCloseTo(58);
    expect(s.margin).toBeCloseTo(11.8);
    expect(s.finance).toBeCloseTo(76);
  });
});
