import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { createRng } from "./rng.ts";
import {
  capacityCents,
  closeStartupQuarter,
  initialStartup,
  marketingGain,
  maxEmployees,
  potentialEstimate,
  potentialFromUniform,
  qualityTarget,
  startupValueCents,
  type StartupQuarterInput,
} from "./startup.ts";

const b = (n: number) => BigInt(n);
const base: StartupQuarterInput = {
  sector: "tech",
  tier: "garage",
  marketingCents: b(0),
  productivityBps: [15_000],
  aiWorkers: 0,
  teamSectorScore: 0,
  noise: 0,
};

describe("market size of a niche", () => {
  it("follows the Pareto shares of ECONOMY.md 6.2 (scaled to game years of one day)", () => {
    const min = BALANCE.startups.potential.minAnnualCents;
    const share = (x: number) => Math.pow(min / x, BALANCE.startups.potential.paretoAlpha);
    expect(share(5 * min)).toBeCloseTo(0.4, 1);
    expect(share(100 * min)).toBeGreaterThan(0.05);
    expect(share(100 * min)).toBeLessThan(0.1);
    expect(share(100_000 * min)).toBeLessThan(0.002);
    expect(potentialFromUniform(1)).toBe(min);
    expect(potentialFromUniform(1e-30)).toBe(BALANCE.startups.potential.maxAnnualCents);
  });
});

describe("one quarter", () => {
  it("skills raise the quality, marketing has diminishing returns", () => {
    expect(qualityTarget(0)).toBe(BALANCE.startups.quality.base);
    expect(qualityTarget(20)).toBeCloseTo((1 + BALANCE.startups.quality.base) / 2, 12);
    const g1 = marketingGain(10_000, 1_000_000);
    const g2 = marketingGain(20_000, 1_000_000);
    expect(g2).toBeGreaterThan(g1);
    expect(g2).toBeLessThan(2 * g1);
  });

  it("players are worth more capacity than AI workers", () => {
    expect(capacityCents([15_000], "tech")).toBeGreaterThan(capacityCents([10_000], "tech"));
    expect(capacityCents([10_000, 10_000], "retail")).toBe(2 * BALANCE.startups.capacityCentsPerProductivity.retail);
  });

  it("sells at most what the team can serve", () => {
    const big = initialStartup(1e12, b(250_000));
    const full = { ...big, awareness: 1, quality: 1 };
    const r = closeStartupQuarter(full, base);
    expect(r.revenueCents).toBe(r.capacityCents);
    expect(r.utilization).toBe(1);
    const more = closeStartupQuarter(full, { ...base, productivityBps: [15_000, 10_000], aiWorkers: 1 });
    expect(more.revenueCents).toBeGreaterThan(r.revenueCents);
    expect(more.aiWorkerCents).toBe(b(BALANCE.startups.aiWorkerCostCentsPerQuarter));
  });

  it("books revenue minus goods, fixed costs, AI workers and marketing", () => {
    const s = { ...initialStartup(4_000_000, b(250_000)), awareness: 0.5, quality: 0.5 };
    const r = closeStartupQuarter(s, { ...base, marketingCents: b(5_000) });
    expect(r.operatingProfitCents).toBe(r.revenueCents - r.cogsCents - r.fixedCents - r.aiWorkerCents - b(5_000));
    expect(r.next.cashCents).toBe(b(250_000) + r.operatingProfitCents);
    expect(r.next.quartersActive).toBe(1);
  });

  it("the market size estimate always contains the truth and narrows", () => {
    for (const [u1, u2] of [
      [0, 0],
      [0.5, 0.9],
      [0.99, 0.01],
    ] as const) {
      const early = potentialEstimate(1_000_000, 0, u1, u2);
      const late = potentialEstimate(1_000_000, 12, u1, u2);
      expect(early.lowCents).toBeLessThan(1_000_000);
      expect(early.highCents).toBeGreaterThan(1_000_000);
      expect(late.highCents - late.lowCents).toBeLessThan(early.highCents - early.lowCents);
    }
  });

  it("the value counts cash and profit, never below zero", () => {
    expect(startupValueCents(b(100_000), b(0), "tech")).toBe(b(100_000));
    expect(startupValueCents(b(100_000), b(10_000), "tech")).toBeGreaterThan(b(100_000));
    expect(startupValueCents(b(-500), b(-100), "tech")).toBe(b(0));
  });
});

describe("garage startups over ten real days (scenario, ADR-057)", () => {
  // A sensible owner: some marketing, AI workers when sold out and profitable.
  const rng = createRng(42);
  const sectors = ["tech", "retail", "energy", "pharma", "logistics"] as const;
  const runs = Array.from({ length: 1_000 }, (_, i) => {
    const r = rng.derive("startup", i);
    const sector = sectors[i % 5]!;
    let state = initialStartup(potentialFromUniform(1 - r.next()), b(BALANCE.startups.garage.foundingCostCents));
    let ai = 0;
    let last = b(0);
    let revenue = b(0);
    let soldOut = false;
    for (let q = 0; q < 40; q++) {
      const marketing = Math.round(Math.max(0, Math.min(Number(state.cashCents) * 0.1, Number(revenue) * 0.1 + 5_000)));
      const result = closeStartupQuarter(state, {
        sector,
        tier: "garage",
        marketingCents: b(marketing),
        productivityBps: [17_000, ...Array<number>(ai).fill(10_000)],
        aiWorkers: ai,
        teamSectorScore: 3,
        noise: r.normal(),
      });
      state = result.next;
      last = result.operatingProfitCents;
      revenue = result.revenueCents;
      soldOut = result.utilization >= 0.99 && ai >= maxEmployees("garage");
      if (
        result.utilization > 0.9 &&
        last > b(BALANCE.startups.aiWorkerCostCentsPerQuarter) &&
        ai < maxEmployees("garage")
      )
        ai++;
      else if (last < b(0) && ai > 0) ai--;
    }
    return { broke: state.cashCents < b(0), profitable: last > b(0), soldOut };
  });
  const share = (pick: (run: (typeof runs)[number]) => boolean) => runs.filter(pick).length / runs.length;

  it("not everyone succeeds: a fifth to two fifths run out of money", () => {
    expect(share((r) => r.broke)).toBeGreaterThan(0.2);
    expect(share((r) => r.broke)).toBeLessThan(0.45);
  });

  it("about half end in profit, a few outgrow the garage", () => {
    expect(share((r) => r.profitable)).toBeGreaterThan(0.45);
    expect(share((r) => r.profitable)).toBeLessThan(0.75);
    expect(share((r) => r.soldOut)).toBeGreaterThan(0.03);
    expect(share((r) => r.soldOut)).toBeLessThan(0.2);
  });
});
