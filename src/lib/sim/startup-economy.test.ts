import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  aiUtilizationBps,
  aiWageDueCents,
  closeStartupHour,
  effectivePotentialCents,
  initialStartup,
  potentialFromUniform,
} from "./startup.ts";
import { awarenessCap, awarenessHour as newAwarenessHour } from "./awareness.ts";

// ADR-188: the old positional form of the hourly awareness step, for a garage of the given stage
const awarenessHour = (a: number, q: number, mk: number, pot: number, price: number, stage: number) =>
  newAwarenessHour({
    awareness: a,
    cap: awarenessCap("garage", stage),
    quality: q,
    priceAwareness: price,
    marketingCentsThisHour: mk,
    effectivePotentialAnnualCents: pot,
  });

const b = (n: number) => BigInt(n);
const sc = BALANCE.startups;
const hours = BALANCE.time.quarterHours;

describe("economy overhaul (ADR-180)", () => {
  it("an AI worker earns more than its wage in every sector when the demand is there", () => {
    for (const sector of ["tech", "retail", "energy", "pharma", "logistics"] as const) {
      const contribution = (sc.capacityCentsPerProductivity[sector] / hours) * sc.grossMargin[sector];
      expect(contribution).toBeGreaterThan(sc.aiWorkerWageCentsPerHour);
    }
  });

  it("AI workers serve what founder and players cannot; idle ones cost only the standby share", () => {
    // capacity 300, of which the AI workers bring 200 (2 of 3 units)
    expect(aiUtilizationBps(50, 300, 2, 3)).toBe(0);
    expect(aiUtilizationBps(200, 300, 2, 3)).toBe(5_000);
    expect(aiUtilizationBps(400, 300, 2, 3)).toBe(10_000);
    expect(aiUtilizationBps(400, 300, 0, 1)).toBe(0);
    expect(aiWageDueCents(2, 0)).toBe(Math.floor((2 * sc.aiWorkerWageCentsPerHour * sc.aiWorkerStandbyBps) / 10_000));
    expect(aiWageDueCents(2, 5_000)).toBe(sc.aiWorkerWageCentsPerHour);
    expect(aiWageDueCents(2, 10_000)).toBe(2 * sc.aiWorkerWageCentsPerHour);
    expect(aiWageDueCents(0, 10_000)).toBe(0);
  });

  it("a busy AI worker adds more gross profit than it costs (the same hour without it)", () => {
    const state = { ...initialStartup(1_000_000, b(0)), awareness: 0.5, quality: 0.6 };
    const input = {
      sector: "retail" as const,
      tier: "small_business" as const,
      marketingCentsPerQuarter: b(0),
      productivityBps: [15_000],
      aiWorkers: 0,
      stage: 1,
      noise: 0,
      playerWagesCents: 0,
    };
    const solo = closeStartupHour(state, input);
    const team = closeStartupHour(state, { ...input, productivityBps: [15_000, 10_000], aiWorkers: 1 });
    expect(solo.demandCents).toBeGreaterThan(team.capacityCents);
    const extraGross = Number(team.revenueCents - team.cogsCents - (solo.revenueCents - solo.cogsCents));
    expect(team.aiUtilizationBps).toBe(10_000);
    expect(extraGross).toBeGreaterThan(Number(team.aiWagesPaidCents));
    expect(team.profitCents).toBeGreaterThan(solo.profitCents);
  });

  it("awareness moves every hour: marketing adds, decay takes, the cap holds (ADR-188)", () => {
    const quiet = awarenessHour(0.2, 0.5, 0, 1e7, 1, 2);
    const loud = awarenessHour(0.2, 0.5, 100_000, 1e7, 1, 2);
    expect(loud.marketing).toBeGreaterThan(0.005);
    expect(loud.next - quiet.next).toBeCloseTo(loud.marketing, 10);
    expect(quiet.decay).toBeCloseTo(sc.awareness.decayPerHour * (0.2 - sc.awareness.min), 10);
    expect(quiet.next).toBeCloseTo(0.2 + quiet.wordOfMouth - quiet.decay, 10);
    expect(awarenessHour(0.69, 1, 1e9, 1e7, 1, 1).next).toBeLessThanOrEqual(0.69);
    expect(awarenessHour(0.6, 1, 1e9, 1e7, 1, 1).next).toBeLessThanOrEqual(awarenessCap("garage", 1));
    expect(awarenessHour(sc.awareness.min, 0, 0, 1e7, 1, 0).next).toBeGreaterThanOrEqual(sc.awareness.min);
  });

  it("a day of the suggested marketing lifts a garage by more than 20 points", () => {
    let a: number = sc.awareness.initial;
    const potential = effectivePotentialCents(potentialFromUniform(0.5), "garage");
    for (let h = 0; h < 24; h++) a = awarenessHour(a, 0.4, 50_000 / hours, potential, 1, 1).next;
    expect(a - sc.awareness.initial).toBeGreaterThan(0.2);
  });

  it("the hour reports its awareness step", () => {
    const state = { ...initialStartup(1_000_000, b(0)), awareness: 0.3, quality: 0.5 };
    const r = closeStartupHour(state, {
      sector: "tech",
      tier: "garage",
      marketingCentsPerQuarter: b(60_000),
      productivityBps: [15_000],
      aiWorkers: 0,
      stage: 1,
      noise: 0,
      playerWagesCents: 0,
    });
    expect(r.awareness.before).toBe(0.3);
    expect(r.awareness.marketing).toBeGreaterThan(0);
    expect(r.awareness.next).toBeGreaterThan(0.3);
  });
});
