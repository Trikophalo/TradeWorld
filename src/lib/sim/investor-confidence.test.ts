import { describe, expect, it } from "vitest";
import { INVESTOR_CONFIDENCE } from "../../config/investor-confidence.ts";
import { COMPANY_EVENTS } from "../../config/company-events.ts";
import {
  addBump,
  aiGrowthPerGameYear,
  confidencePressure,
  confidenceSignal,
  confidenceTarget,
  crisisStartBump,
  decayEvents,
  dilutionBump,
  earningsBump,
  incidentBump,
  incidentChancePerHour,
  incidentSeverity,
  insiderBump,
  moodLabel,
  payoutBump,
  phaseMinutes,
  pickPhase,
  stateFactors,
  stepConfidence,
  stepMood,
  topReasons,
  volatilityOf,
  withdrawBump,
} from "./investor-confidence.ts";
import { createRng } from "./rng.ts";
import { drawdowns, simulateMarket, windowReturns } from "./confidence-market.ts";

const cfg = INVESTOR_CONFIDENCE;

describe("confidence signal and AI order flow (ADR-216)", () => {
  it("is zero at 50, symmetric, saturates and panics below 15", () => {
    expect(confidenceSignal(50)).toBe(0);
    expect(confidenceSignal(75)).toBeCloseTo(0.5);
    expect(confidenceSignal(25)).toBeCloseTo(-0.5);
    expect(confidenceSignal(20)).toBeCloseTo(-0.6);
    expect(confidenceSignal(10)).toBe(-1);
    expect(confidenceSignal(100)).toBe(1);
    expect(confidenceSignal(0)).toBe(-1);
    for (let c = 0; c <= 100; c += 5) expect(confidenceSignal(c)).toBeCloseTo(-confidenceSignal(100 - c));
  });

  it("buys with high and sells with low confidence, scaled by the free float", () => {
    expect(confidencePressure(80, 1_000_000)).toBeGreaterThan(0);
    expect(confidencePressure(20, 1_000_000)).toBeLessThan(0);
    expect(confidencePressure(100, 1_000_000)).toBeCloseTo(1_000_000 * 0.25 * 0.0005);
  });
});

describe("event bumps", () => {
  it("are capped per key and fade with their half-life", () => {
    let f = addBump({}, "earnings", 50);
    expect(f.earnings).toBe(cfg.events.earnings.max);
    f = decayEvents(f, 12 * 60);
    expect(f.earnings).toBeCloseTo(cfg.events.earnings.max / 2);
    f = decayEvents(f, 30 * 24 * 60);
    expect(f.earnings).toBeUndefined();
  });

  it("price earnings, dividends, withdrawals, insider sells, dilution and crises", () => {
    expect(earningsBump(-0.5)).toBe(-15);
    expect(payoutBump(1_000_000, 100_000_000)).toBe(4);
    expect(payoutBump(1, 100_000_000)).toBe(cfg.events.payout.min);
    expect(withdrawBump(500_000, 1_000_000)).toBe(-16);
    expect(withdrawBump(1_000_000, 1_000_000)).toBe(-30);
    expect(insiderBump(50, 100)).toBe(-15.5);
    expect(dilutionBump(1_000, 1_200)).toBeCloseTo(-8);
    expect(dilutionBump(1_000, 1_000)).toBe(0);
    expect(crisisStartBump("shitstorm", "crisis", 2)).toEqual({ key: "scandal", delta: -14 });
    expect(crisisStartBump("tariffs", "crisis", 1).delta).toBeCloseTo(-6.5);
    expect(crisisStartBump("big_contract", "chance", 2)).toEqual({ key: "event", delta: 6 });
  });
});

describe("stock incidents", () => {
  it("come more often the hotter and the bigger the stock", () => {
    expect(incidentChancePerHour(0, 100_000_000)).toBeCloseTo(cfg.incidents.basePerHour);
    expect(incidentChancePerHour(1, 100_000_000)).toBeCloseTo(cfg.incidents.basePerHour + cfg.incidents.perHeatPerHour);
    expect(incidentChancePerHour(1, 10_000_000_000)).toBeCloseTo(
      (cfg.incidents.basePerHour + cfg.incidents.perHeatPerHour) * (1 + 2 * cfg.incidents.perWorthDecade),
    );
    expect(incidentChancePerHour(100, 100_000_000)).toBe(cfg.incidents.maxPerHour);
    // a stock at 3 × its fair value (heat ≈ 1,7) is hit within a day with ≥ 90 %
    expect(1 - Math.exp(-24 * incidentChancePerHour(1.7, 100_000_000))).toBeGreaterThan(0.9);
    expect([incidentSeverity(0.2), incidentSeverity(1), incidentSeverity(2)]).toEqual([1, 2, 3]);
  });

  it("crash the confidence, come back step by step, bad strategies cost more", () => {
    expect(incidentBump("start", 3)).toBe(-27);
    expect(incidentBump("stepSucceeded", 2)).toBe(5);
    expect(incidentBump("stepFailed", 2)).toBe(-3);
    expect(incidentBump("badStrategy", 1)).toBe(-6);
    expect(incidentBump("solved", 1)).toBe(4);
    expect(incidentBump("lost", 1)).toBe(-5);
  });

  it("are company events with several steps, never drawn by the daily roll, every bad strategy exists", () => {
    const incidents = COMPANY_EVENTS.archetypes.filter((a) => a.incident);
    expect(incidents.length).toBeGreaterThanOrEqual(8);
    for (const a of incidents) {
      expect(a.weight, a.key).toBe(0);
      expect(a.polarity).toBe("crisis");
      const best = Math.max(...a.strategies.map((s) => s.steps.length));
      expect(best, a.key).toBeGreaterThanOrEqual(3);
    }
    const strategyKeys = new Set(incidents.flatMap((a) => a.strategies.map((s) => s.key)));
    for (const bad of cfg.incidents.badStrategies) expect(strategyKeys.has(bad), bad).toBe(true);
    // every incident offers a cheap way out that the investors punish
    for (const a of incidents)
      expect(
        a.strategies.some((s) => (cfg.incidents.badStrategies as readonly string[]).includes(s.key)),
        a.key,
      ).toBe(true);
    for (const a of incidents)
      expect(cfg.incidents.news[a.key as keyof typeof cfg.incidents.news], a.key).toBeDefined();
  });
});

describe("state factors", () => {
  it("as in investor_confidence_state()", () => {
    const f = stateFactors({
      profitRecentCents: 120,
      profitPriorCents: 100,
      reputation: 70,
      crisisSeverity: 2,
      incidentSeverity: 3,
      countryRisk: 40,
      talentTiers: 3,
      coCeo: true,
      volatility: 0.045,
      mood: 30,
      sectorTilt: 7,
      logReturn24h: Math.log(1.2),
      logPremium: Math.log(1.5),
      chatter: 1.25,
    });
    expect(f).toEqual({
      profit: Math.round(8 * Math.tanh(0.2) * 10) / 10,
      reputation: 4,
      crisis: -6,
      incident_open: -15,
      country: -4.8,
      management: 3.8,
      volatility: -2.4,
      macro: -10,
      sector: 7,
      momentum: Math.round(10 * Math.tanh(Math.log(1.2) / 0.15) * 10) / 10,
      valuation: Math.round(-12 * Math.tanh(Math.log(1.5) / 0.35) * 10) / 10,
      chatter: 1.3,
    });
  });

  it("target, smoothing, volatility and reasons", () => {
    expect(confidenceTarget({ a: 30, b: 40 })).toBe(100);
    expect(confidenceTarget({ a: -10 })).toBe(40);
    expect(stepConfidence(50, 60)).toBeCloseTo(50 + 10 * cfg.smoothingPerMinute);
    expect(volatilityOf([100, 100, 100])).toBeNull();
    expect(volatilityOf([100, 100, 100, 100])).toBe(0);
    expect(topReasons({ macro: -12, chatter: 1.2, earnings: 8, momentum: -3, valuation: 2, sector: 7 })).toEqual([
      { key: "macro", points: -12 },
      { key: "earnings", points: 8 },
      { key: "sector", points: 7 },
      { key: "momentum", points: -3 },
    ]);
  });
});

describe("market mood", () => {
  it("phases are drawn by weight, last minHours..maxHours, and the mood follows their target", () => {
    expect(pickPhase(0)).toBe("bull");
    expect(pickPhase(0.999)).toBe("bear");
    expect(phaseMinutes("bear", 0)).toBe(cfg.mood.phases.bear.minHours * 60);
    let s = { mood: 50, phase: "bear" as const, phaseMinutesLeft: 10_000 } as Parameters<typeof stepMood>[0];
    for (let i = 0; i < 24 * 60; i++) s = stepMood(s, 0, 0.5, 0.5);
    expect(s.mood).toBeLessThan(32);
    expect(moodLabel(s.mood)).toBe("fear");
  });

  it("the long-run mean is about neutral, so there is no drift", () => {
    const rng = createRng(7);
    let s = { mood: 50, phase: "calm" as const, phaseMinutesLeft: 600 } as Parameters<typeof stepMood>[0];
    let sum = 0;
    const n = 60 * 24 * 120;
    for (let i = 0; i < n; i++) {
      s = stepMood(s, rng.normal(), rng.next(), rng.next());
      sum += s.mood;
    }
    expect(Math.abs(sum / n - 50)).toBeLessThan(5);
  });

  it("AI business grows little on average and shrinks in a bear market", () => {
    expect(aiGrowthPerGameYear(800, 50)).toBeCloseTo(0.008);
    expect(aiGrowthPerGameYear(800, 25)).toBeLessThan(0);
    expect(aiGrowthPerGameYear(800, 75)).toBeGreaterThan(0.04);
  });
});

describe("market harness (real ticks)", () => {
  it("after ADR-216 AI stocks no longer only rise: two days, both directions", () => {
    const before = simulateMarket("before", 2, 3);
    const after = simulateMarket("after", 2, 3);
    const day = (r: typeof before) => windowReturns(r, "ai", 24, 24, true);
    expect(day(after).some((x) => x < -0.01)).toBe(true);
    expect(day(after).some((x) => x > 0.01)).toBe(true);
    expect(drawdowns(after.index).maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(after.confidence.every((c) => c.every((x) => x >= 0 && x <= 100))).toBe(true);
    expect(day(before).length).toBe(day(after).length);
  }, 30_000);
});
