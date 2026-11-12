import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { createRng } from "./rng.ts";
import { skillNode } from "./skills.ts";
import {
  canExpand,
  capacityCents,
  closeStartupHour,
  effectivePotentialCents,
  expansionCapacityFactor,
  expansionCostCents,
  fixedCostCents,
  priceEffect,
  closeStartupQuarter,
  companyStage,
  trainingFor,
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
  stage: 4,
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
        // The founder brings the first stage's skill; later stages need specialists.
        stage: 1,
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

describe("growth stages (ADR-062)", () => {
  it("need the skills of every stage in order", () => {
    const product = BALANCE.startups.products.tech[0]!;
    const all = new Set(product.stages.flat());
    expect(companyStage("tech", product.key, new Set())).toBe(0);
    expect(companyStage("tech", product.key, new Set(product.stages[0]))).toBe(1);
    expect(companyStage("tech", product.key, new Set(product.stages[1]))).toBe(0);
    expect(companyStage("tech", product.key, all)).toBe(product.stages.length);
  });

  it("cap the awareness: without specialists no growth", () => {
    const s = { ...initialStartup(1e9, b(1_000_000)), awareness: 0.9, quality: 1 };
    const capped = closeStartupQuarter(s, { ...base, stage: 0 });
    expect(capped.next.awareness).toBeLessThanOrEqual(BALANCE.startups.stages.awarenessCaps[0]!);
    expect(closeStartupQuarter(s, { ...base, stage: 4 }).next.awareness).toBeGreaterThan(0.8);
  });

  it("every product's skills exist on the skill map", () => {
    for (const products of Object.values(BALANCE.startups.products)) {
      for (const p of products) for (const skill of p.stages.flat()) expect(skillNode(skill), skill).toBeDefined();
    }
  });

  it("start with basics: stage n asks for skills of at most tier n + 1 (stage 1: tier 2)", () => {
    for (const products of Object.values(BALANCE.startups.products)) {
      for (const p of products) {
        p.stages.forEach((skills, i) => {
          for (const skill of skills)
            expect(skillNode(skill)!.tier, `${p.key} stage ${i + 1}: ${skill}`).toBeLessThanOrEqual(i + 2);
        });
      }
    }
  });

  it("trainings get dearer with the tier", () => {
    expect(trainingFor(1).costCents).toBeLessThan(trainingFor(5).costCents);
    expect(trainingFor(9).costCents).toBe(trainingFor(5).costCents);
  });
});

describe("AI workers grow a company slower than players (ADR-069)", () => {
  it("lower the quality the team can reach", () => {
    const s = { ...initialStartup(1e9, b(1_000_000)), awareness: 0.5, quality: 0.5 };
    const players = closeStartupQuarter(s, {
      ...base,
      productivityBps: [15_000, 15_000],
      aiWorkers: 0,
      teamSectorScore: 10,
    });
    const ai = closeStartupQuarter(s, {
      ...base,
      productivityBps: [15_000, 10_000],
      aiWorkers: 1,
      teamSectorScore: 10,
    });
    expect(ai.next.quality).toBeLessThan(players.next.quality);
    expect(ai.capacityCents).toBeLessThan(players.capacityCents);
  });
});

describe("operating hours (ADR-072)", () => {
  const hourInput = {
    sector: "tech" as const,
    tier: "garage" as const,
    marketingCentsPerQuarter: b(60_000),
    productivityBps: [15_000, 10_000],
    aiWorkers: 1,
    stage: 1,
    noise: 0,
    playerWagesCents: 20_000,
  };

  it("pays players and AI workers with the same factor, never more than the hour earned", () => {
    const small = { ...initialStartup(2_000_000, b(1_000_000)), awareness: 0.3, quality: 0.5 };
    const r = closeStartupHour(small, hourInput);
    const gross = r.revenueCents - r.cogsCents;
    expect(r.payFactorBps).toBeLessThan(10_000);
    expect(r.playerWagesPaidCents + r.aiWagesPaidCents).toBeLessThanOrEqual(gross);
    expect(Number(r.aiWagesPaidCents) / BALANCE.startups.aiWorkerWageCentsPerHour).toBeCloseTo(
      Number(r.playerWagesPaidCents) / 20_000,
      3,
    );
  });

  it("pays everything when the hour earns enough", () => {
    const big = { ...initialStartup(1e12, b(1_000_000)), awareness: 1, quality: 1 };
    const r = closeStartupHour(big, hourInput);
    expect(r.payFactorBps).toBe(10_000);
    expect(r.aiWagesPaidCents).toBe(b(BALANCE.startups.aiWorkerWageCentsPerHour));
    expect(r.playerWagesPaidCents).toBe(b(20_000));
  });

  it("without sales nobody is paid, fixed costs and marketing still run", () => {
    const none = { ...initialStartup(0, b(0)), awareness: 0, quality: 0 };
    const r = closeStartupHour(none, hourInput);
    expect(r.revenueCents).toBe(b(0));
    expect(r.payFactorBps).toBe(0);
    expect(r.playerWagesPaidCents + r.aiWagesPaidCents).toBe(b(0));
    expect(r.profitCents).toBe(-(r.fixedCents + r.marketingCents));
  });

  it("books revenue minus goods, wages, fixed costs and marketing", () => {
    const s = { ...initialStartup(50_000_000, b(0)), awareness: 0.6, quality: 0.6 };
    const r = closeStartupHour(s, hourInput);
    expect(r.profitCents).toBe(
      r.revenueCents - r.cogsCents - r.playerWagesPaidCents - r.aiWagesPaidCents - r.fixedCents - r.marketingCents,
    );
  });

  it("a quarter's hours sell what the quarter would (same awareness and quality, no noise)", () => {
    const s = { ...initialStartup(50_000_000, b(0)), awareness: 0.6, quality: 0.6 };
    const hour = closeStartupHour(s, { ...hourInput, noise: 0 });
    const quarter = closeStartupQuarter(s, { ...base, productivityBps: [15_000, 10_000], aiWorkers: 1, stage: 1 });
    const demandQuarter = Number(hour.demandCents) * BALANCE.time.quarterHours;
    expect(Math.abs(demandQuarter - (50_000_000 / 4) * 0.6 * 0.8) / demandQuarter).toBeLessThan(0.01);
    expect(Number(hour.capacityCents) * BALANCE.time.quarterHours).toBeCloseTo(Number(quarter.capacityCents), -2);
  });
});

describe("profit levers and growth without limit (ADR-083)", () => {
  const hourInput = {
    sector: "tech" as const,
    tier: "garage" as const,
    marketingCentsPerQuarter: b(0),
    productivityBps: [15_000],
    aiWorkers: 0,
    stage: 1,
    noise: 0,
    playerWagesCents: 0,
  };
  const young = { ...initialStartup(337_000, b(0)), awareness: 0.03, quality: 0.3 };

  it("contract work sells part of the unused capacity at the contract margin", () => {
    const off = closeStartupHour(young, hourInput);
    const on = closeStartupHour(young, { ...hourInput, contractWork: true });
    expect(off.contractRevenueCents).toBe(b(0));
    const free = Number(on.capacityCents) - Number(on.demandCents);
    expect(Number(on.contractRevenueCents)).toBeCloseTo(free * BALANCE.startups.contractWork.shareOfFreeCapacity, -1);
    expect(on.revenueCents - on.contractRevenueCents).toBe(off.revenueCents);
    expect(on.profitCents).toBeGreaterThan(off.profitCents);
  });

  it("a young garage with contract work covers its fixed costs (no more endless minus)", () => {
    const r = closeStartupHour(young, { ...hourInput, contractWork: true });
    expect(r.profitCents).toBeGreaterThan(b(0));
    // An AI worker is not a money printer: contract work alone does not pay its wage.
    const capacityPerAi = BALANCE.startups.capacityCentsPerProductivity.tech / BALANCE.time.quarterHours;
    const aiGross =
      capacityPerAi * BALANCE.startups.contractWork.shareOfFreeCapacity * BALANCE.startups.contractWork.grossMargin;
    expect(aiGross).toBeLessThan(BALANCE.startups.aiWorkerWageCentsPerHour);
  });

  it("contract work never applies to sold-out capacity", () => {
    const full = { ...initialStartup(1e12, b(0)), awareness: 1, quality: 1 };
    const r = closeStartupHour(full, { ...hourInput, contractWork: true });
    expect(r.contractRevenueCents).toBe(b(0));
  });

  it("budget sells more and spreads faster, premium earns more per unit but needs quality", () => {
    expect(priceEffect("budget", 0.5).demand).toBeGreaterThan(1);
    expect(priceEffect("budget", 0.5).awareness).toBeGreaterThan(1);
    expect(priceEffect("premium", 0.8).price).toBeGreaterThan(1);
    expect(priceEffect("premium", 0.2).demand).toBeLessThan(priceEffect("premium", 0.8).demand);
    expect(priceEffect(undefined, 0.5)).toEqual(priceEffect("normal", 0.5));

    const known = { ...initialStartup(10_000_000, b(0)), awareness: 0.5, quality: 0.8 };
    const normal = closeStartupHour(known, hourInput);
    const premium = closeStartupHour(known, { ...hourInput, priceLevel: "premium" });
    const budget = closeStartupHour(known, { ...hourInput, priceLevel: "budget" });
    expect(budget.demandCents).toBeGreaterThan(normal.demandCents);
    expect(premium.revenueCents - premium.cogsCents).toBeGreaterThan(normal.revenueCents - normal.cogsCents);

    const quarter = (priceLevel: "budget" | "premium") => closeStartupQuarter(young, { ...base, priceLevel });
    expect(quarter("budget").next.awareness).toBeGreaterThan(quarter("premium").next.awareness);
  });

  it("a bigger legal form reaches a bigger market; upgrading the same company grows it", () => {
    const tiers = ["garage", "small_business", "gmbh", "ag"] as const;
    const markets = tiers.map((tier) => effectivePotentialCents(1_000_000, tier));
    for (let i = 1; i < markets.length; i++) expect(markets[i]!).toBeGreaterThan(markets[i - 1]!);
  });

  it("founding bigger directly buys a head start in awareness", () => {
    expect(initialStartup(1, b(0), BALANCE.startups, "gmbh").awareness).toBeGreaterThan(
      initialStartup(1, b(0)).awareness,
    );
  });

  it("expansion never ends: every level adds market, capacity, places and costs, each step costs more", () => {
    expect(canExpand("garage")).toBe(false);
    expect(canExpand("gmbh")).toBe(true);
    for (const n of [0, 1, 5, 20, 60]) {
      expect(effectivePotentialCents(1_000_000, "ag", n + 1)).toBeGreaterThan(
        effectivePotentialCents(1_000_000, "ag", n),
      );
      expect(expansionCapacityFactor(n + 1)).toBeGreaterThan(expansionCapacityFactor(n));
      expect(maxEmployees("ag", BALANCE, n + 1)).toBeGreaterThan(maxEmployees("ag", BALANCE, n));
      expect(fixedCostCents("ag", BALANCE, n + 1)).toBeGreaterThan(fixedCostCents("ag", BALANCE, n));
      expect(expansionCostCents(n + 1)).toBeGreaterThan(expansionCostCents(n));
      expect(Number.isFinite(expansionCostCents(n))).toBe(true);
    }
    expect(expansionCostCents(0)).toBe(BALANCE.startups.expansion.baseCostCents);
    expect(fixedCostCents("ag")).toBe(BALANCE.startups.ag.fixedCostCentsPerQuarter);
  });

  it("an expanded company sells more in the same hour when demand is there", () => {
    const s = { ...initialStartup(1e10, b(0)), awareness: 1, quality: 1 };
    const flat = closeStartupHour(s, { ...hourInput, tier: "ag" });
    const grown = closeStartupHour(s, { ...hourInput, tier: "ag", expansionLevel: 3 });
    expect(grown.revenueCents).toBeGreaterThan(flat.revenueCents);
  });
});
