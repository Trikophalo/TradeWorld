import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  awarenessAdd,
  awarenessCap,
  awarenessHour,
  awarenessOfCap,
  halfSaturationMarketingCents,
  marketingRate,
} from "./awareness.ts";
import { closeStartupHour, effectivePotentialCents, initialStartup, potentialFromUniform } from "./startup.ts";
import { strengthsInstant, strengthsStep, EMPTY_STRENGTHS } from "./company-strengths.ts";

const cfg = BALANCE.startups.awareness;
const hours = BALANCE.time.quarterHours;
const potential = effectivePotentialCents(potentialFromUniform(0.5), "garage");
const normal = halfSaturationMarketingCents(potential);
const base = {
  awareness: 0.2,
  cap: 0.6,
  quality: 0.5,
  priceAwareness: 1,
  marketingCentsThisHour: 0,
  effectivePotentialAnnualCents: potential,
};

/** Hours of one strategy for a fresh garage (the harness of ADR-188). */
function run(marketingPerQuarter: number, tasksPerHour: number, flyerEveryDay: boolean, upTo: number): number[] {
  const cap = awarenessCap("garage", 0);
  let a: number = cfg.initial;
  const out = [a];
  for (let h = 0; h < upTo; h++) {
    if (flyerEveryDay && h % 24 === 0) a += awarenessAdd(a, cap, BALANCE.startups.campaigns.kinds.flyer.awareness);
    for (let t = 0; t < tasksPerHour; t++) a += awarenessAdd(a, cap, cfg.taskGain);
    a = awarenessHour({ ...base, awareness: a, cap, marketingCentsThisHour: marketingPerQuarter / hours }).next;
    out.push(a);
  }
  return out;
}

describe("awareness (ADR-188)", () => {
  it("the cap grows with tier, stage and expansion and is never above max", () => {
    expect(awarenessCap("garage", 0)).toBeCloseTo(0.6, 10);
    expect(awarenessCap("garage", 2, 1)).toBeCloseTo(0.6 + 2 * cfg.cap.perStage + cfg.cap.perExpansionLevel, 10);
    expect(awarenessCap("small_business", 0)).toBeGreaterThan(awarenessCap("garage", 0));
    expect(awarenessCap("gmbh", 0)).toBeGreaterThan(awarenessCap("small_business", 0));
    expect(awarenessCap("ag", 4, 20)).toBe(cfg.cap.max);
    expect(BALANCE.startups.stages.awarenessCaps.map((_, s) => awarenessCap("garage", s))).toEqual(
      BALANCE.startups.stages.awarenessCaps.map((c) => expect.closeTo(c, 10)),
    );
  });

  it("marketing closes part of the gap to the cap, with diminishing returns", () => {
    expect(marketingRate(0, potential)).toBe(0);
    expect(marketingRate(normal / hours, potential)).toBeCloseTo(cfg.marketingMaxRatePerHour / 2, 10);
    const r1 = marketingRate(normal / hours, potential);
    const r2 = marketingRate((2 * normal) / hours, potential);
    expect(r2).toBeGreaterThan(r1);
    expect(r2).toBeLessThan(2 * r1);
    const h = awarenessHour({ ...base, marketingCentsThisHour: normal / hours });
    expect(h.marketing).toBeCloseTo(r1 * (0.6 - 0.2), 10);
    // closer to the cap, less per hour
    expect(awarenessHour({ ...base, awareness: 0.5, marketingCentsThisHour: normal / hours }).marketing).toBeLessThan(
      h.marketing,
    );
  });

  it("word of mouth grows with awareness, quality, served demand and reputation; zero at the cap", () => {
    const w = awarenessHour(base).wordOfMouth;
    expect(w).toBeCloseTo(cfg.wordOfMouthPerHour * 0.2 * (1 - 0.2 / 0.6) * 1 * 1 * 1 * 1, 10);
    expect(awarenessHour({ ...base, quality: 1 }).wordOfMouth).toBeGreaterThan(w);
    expect(awarenessHour({ ...base, servedShare: 0.5 }).wordOfMouth).toBeCloseTo(w / 2, 10);
    expect(awarenessHour({ ...base, reputation: 100 }).wordOfMouth).toBeCloseTo(w * 1.5, 10);
    expect(awarenessHour({ ...base, awareness: 0.6 }).wordOfMouth).toBe(0);
  });

  it("decay pulls slowly toward the floor and never below it", () => {
    const h = awarenessHour(base);
    expect(h.decay).toBeCloseTo(cfg.decayPerHour * (0.2 - cfg.min), 10);
    expect(h.next).toBeCloseTo(0.2 + h.wordOfMouth - h.decay, 10);
    expect(awarenessHour({ ...base, awareness: cfg.min }).decay).toBe(0);
    expect(awarenessHour({ ...base, awareness: 0, quality: 0 }).next).toBe(cfg.min);
    // a cap that fell below the value (an expert left): no gains, only decay
    const above = awarenessHour({ ...base, awareness: 0.7, marketingCentsThisHour: 1e9 });
    expect(above.marketing).toBe(0);
    expect(above.next).toBeLessThan(0.7);
  });

  it("single events stop at the cap and the floor", () => {
    expect(awarenessAdd(0.2, 0.6, 0.05)).toBeCloseTo(0.05, 10);
    expect(awarenessAdd(0.58, 0.6, 0.05)).toBeCloseTo(0.02, 10);
    expect(awarenessAdd(0.7, 0.6, 0.05)).toBe(0);
    expect(awarenessAdd(0.03, 0.6, -0.05)).toBeCloseTo(cfg.min - 0.03, 10);
  });

  it("harness: normal marketing takes a garage from 3 % to about 30 % in a day and near its cap in four", () => {
    const none = run(0, 0, false, 168);
    const marketing = run(normal, 0, false, 168);
    const active = run(normal, 1, true, 168);
    expect(marketing[1]! - marketing[0]!).toBeGreaterThan(0.01); // the first hour already shows +1 point and more
    expect(marketing[24]!).toBeGreaterThan(0.28);
    expect(marketing[24]!).toBeLessThan(0.4);
    expect(marketing[96]!).toBeGreaterThan(0.85 * 0.6);
    expect(active[24]!).toBeGreaterThan(marketing[24]! + 0.05);
    expect(active[72]!).toBeGreaterThan(0.58);
    expect(Math.max(...active)).toBeLessThanOrEqual(0.6 + 1e-12);
    expect(none[24]!).toBeLessThan(0.05);
    expect(none[168]!).toBeGreaterThan(none[0]!); // word of mouth alone still grows a little
  });

  it("the hour of a company uses the same model and cap", () => {
    const state = { ...initialStartup(potentialFromUniform(0.5), BigInt(0)), awareness: 0.2, quality: 0.5 };
    const r = closeStartupHour(state, {
      sector: "tech",
      tier: "garage",
      marketingCentsPerQuarter: BigInt(normal),
      productivityBps: [10_000],
      aiWorkers: 0,
      stage: 1,
      noise: 0,
      playerWagesCents: 0,
      expansionLevel: 1,
    });
    expect(r.awareness.cap).toBeCloseTo(awarenessCap("garage", 1, 1), 10);
    expect(r.awareness.marketing).toBeGreaterThan(0);
    expect(r.awareness.next).toBeGreaterThan(0.2);
  });

  it("the strength follows awareness / cap within hours, not days", () => {
    const sc = BALANCE.companyHealth.strengths;
    const hour = {
      awareness: awarenessOfCap(0.49, 0.6),
      quality: 0.5,
      demandCents: 1,
      capacityCents: 1,
      revenueCents: 1,
      profitCents: 0,
      payFactorBps: 10_000,
      cashCents: 0,
      unpaidCents: 0,
    };
    let s = EMPTY_STRENGTHS;
    for (let h = 0; h < 3; h++) s = strengthsStep(s, strengthsInstant(hour, sc), sc);
    // the owner's screenshot: 49 % awareness showed 4 of 100 after three hours; now more than half the way
    expect(s.awareness).toBeGreaterThan(40);
    for (let h = 0; h < 21; h++) s = strengthsStep(s, strengthsInstant(hour, sc), sc);
    expect(s.awareness).toBeCloseTo(100 * awarenessOfCap(0.49, 0.6), 0);
  });
});
