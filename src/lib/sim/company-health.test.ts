import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  HEALTH_FACTORS,
  companyHealth,
  modelProfitCents,
  suggestedMarketingCents,
  type HealthCompany,
  type HealthExtras,
  type HealthFactorKey,
} from "./company-health.ts";
import { closeStartupHour, type StartupHourInput, type StartupState } from "./startup.ts";

const sc = BALANCE.startups;
const hours = BALANCE.time.quarterHours;

const stages = (reached: number, covered = true): HealthCompany["stages"] =>
  [1, 2, 3, 4].map((stage) => ({
    stage,
    reached: stage <= reached,
    skills: [
      { key: `skill_${stage}_a`, coveredBy: stage <= reached || covered ? "Anna" : null, coveredByAi: false },
      { key: `skill_${stage}_b`, coveredBy: stage <= reached ? "Anna" : null, coveredByAi: false },
    ],
  }));

interface Setup {
  potential?: number;
  awareness?: number;
  quality?: number;
  productivity?: number[];
  aiWorkers?: number;
  playerWages?: number;
  input?: Partial<StartupHourInput>;
  company?: Partial<HealthCompany>;
}

/** A company whose last hour is what closeStartupHour computes for it. */
function company(s: Setup = {}): HealthCompany {
  const state: StartupState = {
    potentialAnnualCents: s.potential ?? 200_000,
    awareness: s.awareness ?? 0.3,
    quality: s.quality ?? 0.6,
    quartersActive: 3,
    cashCents: BigInt(500_000),
  };
  const aiWorkers = s.aiWorkers ?? 0;
  const productivity = s.productivity ?? [15_000, ...Array.from({ length: aiWorkers }, () => 10_000)];
  const input: StartupHourInput = {
    sector: "tech",
    tier: "small_business",
    marketingCentsPerQuarter: BigInt(0),
    productivityBps: productivity,
    aiWorkers,
    stage: 1,
    noise: 0,
    playerWagesCents: s.playerWages ?? 0,
    priceLevel: "normal",
    contractWork: true,
    expansionLevel: 0,
    ...s.input,
  };
  const r = closeStartupHour(state, input, BALANCE);
  const marketFactor = sc.marketFactorByTier[input.tier];
  return {
    sector: input.sector,
    tier: input.tier,
    priceLevel: input.priceLevel ?? "normal",
    contractWork: input.contractWork ?? false,
    expansionLevel: input.expansionLevel ?? 0,
    stage: input.stage,
    stages: stages(input.stage),
    awarenessBps: Math.round(state.awareness * 10_000),
    qualityBps: Math.round(state.quality * 10_000),
    marketingCentsPerQuarter: Number(input.marketingCentsPerQuarter),
    aiWorkers,
    aiWageCentsPerHour: sc.aiWorkerWageCentsPerHour,
    headcount: aiWorkers,
    maxEmployees: 5,
    capacityCents: productivity.reduce((a, p) => a + p / 10_000, 0) * sc.capacityCentsPerProductivity.tech,
    cashCents: 500_000,
    unpaidCents: 0,
    distress: false,
    distressQuarters: 0,
    graceQuarters: 4,
    estimateLowCents: state.potentialAnnualCents * marketFactor * 0.8,
    estimateHighCents: state.potentialAnnualCents * marketFactor * 1.25,
    payFactorBps: r.payFactorBps,
    campaign: null,
    campaignCosts: { flyer: 10_000, online: 30_000, tv: 90_000 },
    canExpand: false,
    canUpgrade: false,
    live: {
      revenuePerHourCents: Number(r.revenueCents),
      profitPerHourCents: Number(r.profitCents),
      payFactorBps: r.payFactorBps,
      contractRevenuePerHourCents: Number(r.contractRevenueCents),
      demandPerHourCents: Number(r.demandCents),
      capacityPerHourCents: Number(r.capacityCents),
      fixedPerHourCents: Number(r.fixedCents),
      aiWagesPerHourCents: Number(r.aiWagesPaidCents),
      marketingPerHourCents: Number(r.marketingCents),
    },
    lastQuarter: { wagesCents: (s.playerWages ?? 0) * hours },
    ...s.company,
  };
}

const factor = (c: HealthCompany, key: HealthFactorKey, extras: HealthExtras = {}) =>
  companyHealth(c, BALANCE, extras).factors.find((f) => f.key === key)!;

describe("company health: the model", () => {
  it("has the eight factors in a fixed order, scores 0..100 with a status", () => {
    const h = companyHealth(company());
    expect(h.factors.map((f) => f.key)).toEqual([...HEALTH_FACTORS]);
    for (const f of h.factors) {
      expect(f.score).toBeGreaterThanOrEqual(0);
      expect(f.score).toBeLessThanOrEqual(100);
      expect(f.impactCents).toBeGreaterThanOrEqual(0);
      expect(["good", "ok", "weak", "critical"]).toContain(f.status);
    }
  });

  it("rebuilds the last hour from the company page (same profit as closeStartupHour)", () => {
    for (const s of [
      {},
      { awareness: 0.9, quality: 0.9 },
      { aiWorkers: 2, playerWages: 3_000 },
      { input: { priceLevel: "premium" as const, contractWork: false } },
      { quality: 0.3, input: { priceLevel: "premium" as const } },
      { awareness: 0.05, aiWorkers: 3, input: { marketingCentsPerQuarter: BigInt(60_000) } },
    ]) {
      const c = company(s);
      expect(Math.abs(modelProfitCents(c) - c.live!.profitPerHourCents)).toBeLessThanOrEqual(2);
    }
  });

  it("splits event, campaign and momentum out of the demand", () => {
    const event = { demandFactor: 0.8, capacityFactor: 1, extraCostShare: 0.05 };
    const c = company({ input: { event, campaignFactor: 1.25, taskMomentum: 1.2 } });
    const extras: HealthExtras = {
      momentum: 1.2,
      event: { polarity: "crisis", severity: 1, now: event, full: event },
    };
    const withCampaign = { ...c, campaign: { demandBps: 2_500 } };
    expect(Math.abs(modelProfitCents(withCampaign, BALANCE, extras) - c.live!.profitPerHourCents)).toBeLessThanOrEqual(
      2,
    );
  });

  it("names the factor that costs the most as the weakest", () => {
    const h = companyHealth(company({ awareness: 0.05 }));
    const top = [...h.factors].sort((a, b) => b.impactCents - a.impactCents)[0]!;
    expect(h.weakest).toBe(top.key);
    expect(top.impactCents).toBeGreaterThan(0);
  });
});

describe("company health: each factor", () => {
  it("awareness: too few customers for the capacity, with the awareness needed", () => {
    const f = factor(company({ awareness: 0.05 }), "awareness");
    expect(f.reason.key).toBe("awareness.low");
    expect(f.reason.values.neededPct).toBeGreaterThan(5);
    expect(f.status).toBe("critical");
    expect(f.impactCents).toBeGreaterThan(0);
    expect(f.levers.map((l) => l.kind)).toContain("marketing");
    expect(factor(company({ awareness: 0.9, quality: 0.9 }), "awareness").score).toBe(100);
  });

  it("awareness at the stage's cap asks for the next stage, not for marketing", () => {
    const c = company({
      awareness: 0.7, // ADR-188: a small business of stage 0 tops out at 70 %
      productivity: [15_000, 15_000, 15_000, 15_000],
      input: { stage: 0 },
      company: { stages: stages(0, false) },
    });
    const f = factor(c, "awareness");
    expect(f.reason.key).toBe("awareness.capped");
    expect(f.levers[0]).toEqual({ kind: "skill", skill: "skill_1_a" });
    expect(f.levers.some((l) => l.kind === "marketing")).toBe(false);
  });

  it("capacity: sold out asks for more hands, idle paid AI workers cost money", () => {
    const sold = factor(company({ awareness: 0.95, quality: 0.9 }), "capacity");
    expect(sold.reason.key).toBe("capacity.soldOut");
    expect(sold.reason.values.demandCents).toBeGreaterThan(sold.reason.values.capacityCents!);
    expect(sold.levers[0]).toMatchObject({ kind: "hireAi" });
    expect(sold.score).toBeLessThan(100);

    const idle = factor(company({ awareness: 0.03, aiWorkers: 3, input: { contractWork: false } }), "capacity");
    expect(idle.reason.key).toBe("capacity.idle");
    expect(idle.impactCents).toBeGreaterThan(0);
    // ADR-180: idle AI workers cost only the standby share, so contract work may beat dismissing them
    expect(idle.levers).toContainEqual({ kind: "dismissAi", count: 3 });

    // Idle hands without AI wages: contract work turns the free capacity into money.
    const free = factor(company({ awareness: 0.03, input: { contractWork: false } }), "capacity");
    expect(free.levers).toEqual([{ kind: "contractWork" }]);
    expect(free.impactCents).toBeGreaterThan(0);
    expect(factor(company({ awareness: 0.03 }), "capacity").reason.key).toBe("capacity.fits");
  });

  it("capacity: no place left for more hands points at growing the company", () => {
    const c = company({ awareness: 0.95, quality: 0.9, company: { maxEmployees: 0, canExpand: true } });
    const f = factor(c, "capacity");
    expect(f.reason.key).toBe("capacity.soldOutFull");
    expect(f.levers[0]).toEqual({ kind: "expand" });
  });

  it("quality: below the target costs demand; premium with poor quality is critical", () => {
    const low = factor(company({ quality: 0.3 }), "quality");
    expect(low.reason.key).toBe("quality.low");
    expect(low.impactCents).toBeGreaterThan(0);
    expect(factor(company({ quality: 0.8 }), "quality").status).toBe("good");
    const premium = factor(company({ quality: 0.3, input: { priceLevel: "premium" } }), "quality");
    expect(premium.reason.key).toBe("quality.premium");
    expect(premium.status).toBe("critical");
    expect(premium.levers[0]).toEqual({ kind: "price", level: "normal" });
  });

  it("image: a crisis lowers it and costs profit, calm is ok, a campaign is good", () => {
    const full = { demandFactor: 0.8, capacityFactor: 1, extraCostShare: 0 };
    const half = { demandFactor: 0.97, capacityFactor: 1, extraCostShare: 0 };
    const c = company({ input: { event: half } });
    const crisis = factor(c, "image", { event: { polarity: "crisis", severity: 1, now: half, full } });
    expect(crisis.reason.key).toBe("image.crisis");
    expect(crisis.reason.values.hitPct).toBe(20);
    expect(crisis.score).toBeLessThan(35);
    expect(crisis.impactCents).toBeGreaterThan(0);
    expect(crisis.levers).toEqual([{ kind: "event" }]);

    const calm = factor(company(), "image");
    expect(calm.reason.key).toBe("image.calm");
    expect(calm.status).toBe("good");
    const campaign = factor({ ...company(), campaign: { demandBps: 2_000 } }, "image");
    expect(campaign.score).toBe(100);
  });

  it("price: finds the strategy that earns more", () => {
    // Sold out with good quality: premium sells the same units for more.
    const f = factor(company({ awareness: 0.95, quality: 0.9 }), "price");
    expect(f.reason.key).toBe("price.better.premium");
    expect(f.levers).toEqual([{ kind: "price", level: "premium" }]);
    expect(f.impactCents).toBeGreaterThan(0);
    const fits = factor(company({ awareness: 0.95, quality: 0.9, input: { priceLevel: "premium" } }), "price");
    expect(fits.reason.key).toBe("price.fits.premium");
    expect(fits.score).toBe(100);
  });

  it("team: missing skills for the next stage, unpaid wages", () => {
    const c = company({ company: { stages: stages(1, false) } });
    const f = factor(c, "team");
    expect(f.reason).toEqual({ key: "team.missing", values: { count: 2, stage: 2 } });
    expect(f.levers[0]).toEqual({ kind: "skill", skill: "skill_2_a" });
    expect(f.score).toBe(Math.round(BALANCE.companyHealth.teamFloor * 100));

    const poor = company({ awareness: 0.03, playerWages: 50_000 });
    expect(poor.live!.payFactorBps).toBeLessThan(10_000);
    const unpaid = factor(poor, "team");
    expect(unpaid.reason.key).toBe("team.unpaid");
    expect(unpaid.status).toBe("critical");
  });

  it("cash: open bills are critical, a loss counts the hours left, wasted marketing shows", () => {
    const bills = factor(
      { ...company(), unpaidCents: 40_000, distress: true, distressQuarters: 3, cashCents: 0 },
      "cash",
    );
    expect(bills.reason.key).toBe("cash.unpaid");
    expect(bills.status).toBe("critical");
    expect(bills.levers[0]).toEqual({ kind: "deposit", cents: 40_000 });

    const losing = company({ awareness: 0.03, aiWorkers: 3, input: { contractWork: false } });
    expect(losing.live!.profitPerHourCents).toBeLessThan(0);
    const burn = factor({ ...losing, cashCents: 10_000 }, "cash");
    expect(burn.reason.key).toBe("cash.burn");
    expect(burn.reason.values.hours).toBeLessThan(BALANCE.companyHealth.runwayTargetHours);
    expect(burn.status).toBe("critical");

    const capped = company({
      awareness: 0.7,
      input: { stage: 0, marketingCentsPerQuarter: BigInt(120_000) },
      company: { stages: stages(0, false) },
    });
    const wasted = factor(capped, "cash");
    expect(wasted.impactCents).toBe(Math.round(120_000 / hours));
    expect(wasted.levers[0]).toEqual({ kind: "marketing", cents: 0 });
  });

  it("momentum: solved tasks lift demand; at 1 it is weak, at the target good", () => {
    const low = factor(company(), "momentum", { momentum: 1, openTasks: 3 });
    expect(low.reason).toMatchObject({ key: "momentum.open", values: { open: 3, boostPct: 0 } });
    expect(low.score).toBe(Math.round(BALANCE.companyHealth.momentumFloor * 100));
    expect(low.impactCents).toBeGreaterThan(0);
    expect(low.levers).toEqual([{ kind: "tasks", open: 3 }]);
    const target = 1 + (BALANCE.companyTasks.momentum.maxBps / 10_000) * BALANCE.companyHealth.momentumTargetShare;
    const high = factor(company({ input: { taskMomentum: target } }), "momentum", { momentum: target });
    expect(high.score).toBe(100);
    expect(high.impactCents).toBe(0);
  });
});

describe("company health: whole companies", () => {
  it("a brand-new garage before its first hour: estimated, nothing breaks", () => {
    const fresh: HealthCompany = {
      ...company(),
      tier: "garage",
      stage: 0,
      stages: stages(0, false),
      awarenessBps: 300,
      qualityBps: 2_500,
      aiWorkers: 0,
      headcount: 0,
      maxEmployees: 2,
      capacityCents: 1.5 * sc.capacityCentsPerProductivity.tech,
      cashCents: 100_000,
      estimateLowCents: 200_000,
      estimateHighCents: 5_000_000,
      live: null,
      lastQuarter: null,
    };
    const h = companyHealth(fresh, BALANCE, { momentum: 1, openTasks: 0 });
    expect(h.estimated).toBe(true);
    expect(h.factors).toHaveLength(8);
    expect(h.factors.find((f) => f.key === "awareness")!.status).toBe("critical");
    expect(h.weakest).toBe("awareness");
    expect(Number.isFinite(h.profitPerHourCents)).toBe(true);
  });

  it("a profitable company scores high and shows its profit", () => {
    const c = company({
      awareness: 0.6,
      quality: 0.85,
      productivity: [15_000, 15_000, 15_000],
      input: { stage: 4, taskMomentum: 1.3 },
      company: { stages: stages(4) },
    });
    const h = companyHealth(c, BALANCE, { momentum: 1.3 });
    expect(h.profitPerHourCents).toBeGreaterThan(0);
    expect(h.score).toBeGreaterThanOrEqual(80);
    expect(h.factors.filter((f) => f.status === "critical")).toHaveLength(0);
  });

  it("a failing company: losing, bills open, several critical factors", () => {
    const c = company({
      awareness: 0.03,
      quality: 0.3,
      aiWorkers: 3,
      input: { priceLevel: "premium", contractWork: false },
    });
    const h = companyHealth({ ...c, unpaidCents: 30_000, distress: true, cashCents: 0 }, BALANCE, { momentum: 1 });
    expect(h.profitPerHourCents).toBeLessThan(0);
    expect(h.score).toBeLessThan(50);
    expect(h.factors.filter((f) => f.status === "critical").length).toBeGreaterThanOrEqual(3);
    expect(h.factors.find((f) => f.key === h.weakest)!.impactCents).toBeGreaterThan(0);
  });

  it("suggests a marketing budget that the page's slider can set", () => {
    const c = company();
    const m = suggestedMarketingCents(c);
    expect(m % 1_000).toBe(0);
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThanOrEqual(Math.max(100_000, Math.round(c.estimateHighCents / 4 / 5 / 1_000) * 1_000));
  });
});
