import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  ageEffects,
  earningsSentiment,
  effectDemandFactor,
  resolvePharmaTrial,
  rollMacroEvents,
  rollPharmaTrialAnnouncement,
  stepCycleIndex,
  stepOilIndex,
} from "./events.ts";
import { createRng } from "./rng.ts";
import type { MacroEffect } from "./types.ts";

describe("pharma trial", () => {
  it("moves the price by 50 to 70 % in either direction", () => {
    const rng = createRng(1);
    let successes = 0;
    const n = 4_000;
    for (let i = 0; i < n; i++) {
      const result = resolvePharmaTrial("midcap", rng);
      expect(Math.abs(result.priceReturn)).toBeGreaterThanOrEqual(0.5);
      expect(Math.abs(result.priceReturn)).toBeLessThanOrEqual(0.7);
      expect(result.priceReturn > 0).toBe(result.success);
      if (result.success) successes++;
    }
    expect(successes / n).toBeCloseTo(BALANCE.events.pharmaTrial.successProbability.midcap, 1);
  });

  it("is deterministic and announced with the configured probability", () => {
    expect(resolvePharmaTrial("penny", createRng(3))).toEqual(resolvePharmaTrial("penny", createRng(3)));
    const rng = createRng(4);
    let hits = 0;
    for (let i = 0; i < 10_000; i++) if (rollPharmaTrialAnnouncement(rng)) hits++;
    expect(hits / 10_000).toBeCloseTo(BALANCE.events.pharmaTrial.probabilityPerQuarter, 1);
  });
});

describe("oil and business cycle", () => {
  it("stay inside their bounds and revert to the baseline", () => {
    const rng = createRng(2);
    let oil = 1;
    let cycle = 1;
    let oilSum = 0;
    let cycleSum = 0;
    const n = 5_000;
    for (let i = 0; i < n; i++) {
      oil = stepOilIndex(oil, rng);
      cycle = stepCycleIndex(cycle, rng);
      expect(oil).toBeGreaterThanOrEqual(BALANCE.events.oilReport.minIndex);
      expect(oil).toBeLessThanOrEqual(BALANCE.events.oilReport.maxIndex);
      expect(cycle).toBeGreaterThanOrEqual(BALANCE.events.businessCycle.minIndex);
      expect(cycle).toBeLessThanOrEqual(BALANCE.events.businessCycle.maxIndex);
      oilSum += oil;
      cycleSum += cycle;
    }
    expect(oilSum / n).toBeCloseTo(1, 1);
    expect(cycleSum / n).toBeCloseTo(1, 1);
    expect(stepOilIndex(2.4, createRng(1))).toBeLessThan(2.4);
  });
});

describe("macro events", () => {
  it("occur with roughly the configured frequency", () => {
    const rng = createRng(5);
    const counts: Record<string, number> = {};
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const roll = rollMacroEvents(rng);
      for (const item of roll.news) {
        const key = item.templateKey.replace(/_(up|down)$/, "");
        counts[key] = (counts[key] ?? 0) + 1;
      }
      expect(roll.effects.length).toBeLessThanOrEqual(3);
      expect(roll.oilFactor).toBeGreaterThan(0);
    }
    const cfg = BALANCE.events.macro;
    expect((counts["macro.sector_crisis"] ?? 0) / n).toBeCloseTo(cfg.sectorCrisis.probabilityPerQuarter, 2);
    expect((counts["macro.commodity_shock"] ?? 0) / n).toBeCloseTo(cfg.commodityShock.probabilityPerQuarter, 2);
    expect((counts["macro.recession"] ?? 0) / n).toBeCloseTo(cfg.recession.probabilityPerQuarter, 2);
    expect((counts["macro.tech_boom"] ?? 0) / n).toBeCloseTo(cfg.techBoom.probabilityPerQuarter, 2);
  });

  it("combines and ages effects", () => {
    const effects: MacroEffect[] = [
      { kind: "recession", sectorId: null, demandFactor: 0.92, quartersRemaining: 2 },
      { kind: "tech_boom", sectorId: "tech", demandFactor: 1.2, quartersRemaining: 1 },
    ];
    expect(effectDemandFactor(effects, "tech")).toBeCloseTo(0.92 * 1.2, 12);
    expect(effectDemandFactor(effects, "retail")).toBeCloseTo(0.92, 12);
    const aged = ageEffects(effects);
    expect(aged).toEqual([{ kind: "recession", sectorId: null, demandFactor: 0.92, quartersRemaining: 1 }]);
    expect(ageEffects(aged)).toEqual([]);
  });
});

describe("earnings sentiment", () => {
  const b = (n: number) => BigInt(n);

  it("is positive for a beat, negative for a miss and clamped", () => {
    const beat = earningsSentiment(b(1_200), b(1_000), b(10_000));
    const miss = earningsSentiment(b(800), b(1_000), b(10_000));
    expect(beat.surprise).toBeCloseTo(0.2, 12);
    const k = BALANCE.events.earnings.sentimentPerSurprise;
    expect(beat.sentimentDelta).toBeCloseTo(0.2 * k, 12);
    expect(miss.sentimentDelta).toBeCloseTo(-0.2 * k, 12);
    expect(earningsSentiment(b(1_000_000), b(1_000), b(10_000)).sentimentDelta).toBe(
      BALANCE.events.earnings.maxSentimentShock,
    );
    expect(earningsSentiment(b(1_000), b(1_000), b(10_000)).sentimentDelta).toBeCloseTo(0, 12);
  });

  it("does not explode around zero profit", () => {
    const s = earningsSentiment(b(100), b(0), b(1_000_000));
    expect(Math.abs(s.surprise)).toBeLessThan(0.01);
  });
});
