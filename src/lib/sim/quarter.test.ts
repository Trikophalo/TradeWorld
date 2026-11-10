import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import type { SectorId } from "../../config/balance.ts";
import { SECTOR_IDS } from "./events.ts";
import {
  SEGMENT_IDS,
  aiAdjustStaffing,
  aiCompanyDecision,
  awarenessAfterTierChange,
  closeQuarter,
  effectiveFixedCostCents,
  effectiveMarketingBudget,
  incumbentAttractiveness,
  marketPriceCents,
  nextQuality,
  priceBandCents,
  qualityTarget,
  sectorDemand,
  segmentBaseDemand,
  segmentDemand,
  segmentForTier,
  tierFixedCostCents,
  unitCostCents,
} from "./quarter.ts";
import { createRng } from "./rng.ts";
import { makeMacro, makePlayerCompany, makeSectorCompanies } from "./test-fixtures.ts";
import type { CompanyState, QuarterDecision, QuarterState } from "./types.ts";

const b = (n: number) => BigInt(n);
const serialize = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));

function world(extra: CompanyState[] = []): QuarterState {
  return { macro: makeMacro(), companies: [...SECTOR_IDS.flatMap((s) => makeSectorCompanies(s)), ...extra] };
}

function reportOf(result: ReturnType<typeof closeQuarter>, id: string) {
  const report = result.reports.find((r) => r.companyId === id);
  if (!report) throw new Error(`no report for ${id}`);
  return report;
}

describe("sector demand", () => {
  it("equals the base demand at baseline", () => {
    for (const s of SECTOR_IDS)
      expect(sectorDemand(s, makeMacro())).toBeCloseTo(BALANCE.sectors[s].baseDemandCentsPerQuarter, 0);
  });

  it("grows with the trend", () => {
    const year1 = sectorDemand("tech", makeMacro({ quarterIndex: 4 }));
    expect(year1 / BALANCE.sectors.tech.baseDemandCentsPerQuarter).toBeCloseTo(1.08, 6);
  });

  it("links the sectors to oil: energy up, retail slightly down (spec 10.1)", () => {
    const high = makeMacro({ oilIndex: 1.3 });
    expect(sectorDemand("energy", high)).toBeGreaterThan(sectorDemand("energy", makeMacro()));
    expect(sectorDemand("retail", high)).toBeLessThan(sectorDemand("retail", makeMacro()));
    expect(unitCostCents("logistics", 1.3)).toBeGreaterThan(unitCostCents("logistics", 1));
    expect(unitCostCents("tech", 1.3)).toBe(unitCostCents("tech", 1));
  });

  it("reacts to the business cycle, logistics most and pharma least", () => {
    const boom = makeMacro({ cycleIndex: 1.1 });
    const lift = (s: SectorId) => sectorDemand(s, boom) / sectorDemand(s, makeMacro());
    expect(lift("logistics")).toBeGreaterThan(lift("retail"));
    expect(lift("retail")).toBeGreaterThan(lift("pharma"));
    expect(lift("pharma")).toBeGreaterThan(1);
  });

  it("falls with higher rates and applies macro effects", () => {
    expect(sectorDemand("tech", makeMacro({ policyRateBps: 500 }))).toBeLessThan(sectorDemand("tech", makeMacro()));
    const crisis = makeMacro({
      activeEffects: [{ kind: "sector_crisis", sectorId: "tech", demandFactor: 0.85, quartersRemaining: 2 }],
    });
    expect(sectorDemand("tech", crisis) / sectorDemand("tech", makeMacro())).toBeCloseTo(0.85, 9);
    expect(sectorDemand("retail", crisis)).toBe(sectorDemand("retail", makeMacro()));
  });
});

describe("market segments", () => {
  it("maps every company tier to exactly one segment", () => {
    expect(segmentForTier("small_business")).toBe("local");
    expect(segmentForTier("gmbh")).toBe("regional");
    expect(segmentForTier("ag")).toBe("national");
    expect(segmentForTier("listed")).toBe("international");
    const tiers = SEGMENT_IDS.map((id) => BALANCE.company.segments[id].tier);
    expect(new Set(tiers).size).toBe(BALANCE.company.tiers.length);
  });

  it("sizes the segments as shares of the sector demand, growing with the tier", () => {
    expect(segmentBaseDemand("tech", "local")).toBeCloseTo(BALANCE.sectors.tech.baseDemandCentsPerQuarter * 0.0018, 3);
    const sizes = SEGMENT_IDS.map((id) => segmentBaseDemand("retail", id));
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1] as number);
    expect(segmentDemand("tech", "international", makeMacro())).toBeCloseTo(sectorDemand("tech", makeMacro()), 3);
  });

  it("only the international market grows with the sector trend", () => {
    const later = makeMacro({ quarterIndex: 40 });
    expect(segmentDemand("tech", "international", later)).toBeGreaterThan(
      segmentDemand("tech", "international", makeMacro()) * 2,
    );
    for (const id of ["local", "regional", "national"] as const) {
      expect(segmentDemand("tech", id, later)).toBeCloseTo(segmentDemand("tech", id, makeMacro()), 3);
    }
  });

  it("small segments still feel the business cycle and macro events", () => {
    const boom = makeMacro({ cycleIndex: 1.1 });
    expect(segmentDemand("logistics", "local", boom)).toBeGreaterThan(segmentDemand("logistics", "local", makeMacro()));
    const crisis = makeMacro({
      activeEffects: [{ kind: "sector_crisis", sectorId: "tech", demandFactor: 0.85, quartersRemaining: 2 }],
    });
    expect(segmentDemand("tech", "local", crisis) / segmentDemand("tech", "local", makeMacro())).toBeCloseTo(0.85, 9);
  });

  it("has anonymous established suppliers in the small segments only", () => {
    for (const s of SECTOR_IDS) {
      expect(incumbentAttractiveness(s, "local", 1)).toBeGreaterThan(0);
      expect(incumbentAttractiveness(s, "regional", 1)).toBeGreaterThan(incumbentAttractiveness(s, "local", 1));
      expect(incumbentAttractiveness(s, "international", 1)).toBe(0);
    }
  });

  it("keeps the number of customers who know a company when it changes tier", () => {
    const local = BALANCE.company.segments.local.demandShare;
    const regional = BALANCE.company.segments.regional.demandShare;
    expect(awarenessAfterTierChange(0.3, "small_business", "gmbh")).toBeCloseTo((0.3 * local) / regional, 12);
    expect(awarenessAfterTierChange(0.3, "gmbh", "small_business")).toBe(1);
    expect(awarenessAfterTierChange(0, "small_business", "gmbh")).toBe(BALANCE.company.marketing.minAwareness);
  });

  it("the reference price is the profit-maximising price of a small company in every sector", () => {
    // Small share: revenue ~ p^-e, so profit per customer budget ~ p^-(e+1) x (p - variable cost).
    const salaryPerPoint =
      (BALANCE.employees.salaryBaseCentsPerQuarter * Math.pow(5, BALANCE.employees.salarySkillExponent)) /
      Math.pow(5, BALANCE.employees.skillCapacityExponent);
    for (const s of SECTOR_IDS) {
      const { costStructure, priceExponent: e } = BALANCE.sectors[s];
      const variableCost = costStructure.unitCostCents + salaryPerPoint / costStructure.capacityUnitsPerSkillPoint;
      const optimum = ((e + 1) / e) * variableCost;
      expect(optimum / costStructure.referencePriceCents).toBeGreaterThan(0.97);
      expect(optimum / costStructure.referencePriceCents).toBeLessThan(1.03);
    }
  });
});

describe("company helpers", () => {
  it("scales fixed costs with the capital intensity of the sector", () => {
    expect(tierFixedCostCents("small_business", "retail")).toBe(b(200_000));
    expect(tierFixedCostCents("small_business", "energy")).toBe(b(280_000));
    expect(tierFixedCostCents("gmbh", "tech")).toBe(b(700_000));
  });

  it("the finance department lowers fixed costs with diminishing returns", () => {
    const fixed = b(4_000_000);
    expect(effectiveFixedCostCents(fixed, 0)).toBe(fixed);
    const half = BALANCE.company.finance.halfSaturationSkillPoints;
    expect(effectiveFixedCostCents(fixed, half)).toBe(b(3_400_000)); // half of the maximum 30 %
    const many = effectiveFixedCostCents(fixed, 1e9);
    expect(many < b(2_810_000) && many >= b(2_800_000)).toBe(true);
  });

  it("the marketing department makes the budget count up to double", () => {
    expect(effectiveMarketingBudget(1000, 0)).toBe(1000);
    expect(effectiveMarketingBudget(1000, BALANCE.company.marketing.departmentHalfSaturationSkillPoints)).toBeCloseTo(
      1500,
      9,
    );
    expect(effectiveMarketingBudget(1000, 1e12)).toBeCloseTo(2000, 3);
  });

  it("offers a wide price slider around the reference price", () => {
    for (const s of SECTOR_IDS) {
      const band = priceBandCents(s);
      const reference = BALANCE.sectors[s].costStructure.referencePriceCents;
      expect(band.min).toBe(Math.ceil(reference * 0.25));
      expect(band.max).toBe(reference * 3);
    }
  });

  it("the market price passes cost changes on one to one", () => {
    expect(marketPriceCents("logistics", 1)).toBe(BALANCE.sectors.logistics.costStructure.referencePriceCents);
    const delta = unitCostCents("logistics", 1.4) - unitCostCents("logistics", 1);
    expect(marketPriceCents("logistics", 1.4) - marketPriceCents("logistics", 1)).toBeCloseTo(delta, 9);
  });

  it("quality needs developers in proportion to the size and the sector", () => {
    expect(qualityTarget(0, 20, "tech")).toBe(0);
    expect(qualityTarget(12, 18, "tech")).toBeGreaterThan(qualityTarget(6, 18, "tech"));
    // The same developers achieve less in a bigger company and less in tech than in retail.
    expect(qualityTarget(12, 90, "tech")).toBeLessThan(qualityTarget(12, 18, "tech"));
    expect(qualityTarget(12, 18, "retail")).toBeGreaterThan(qualityTarget(12, 18, "tech"));
    expect(qualityTarget(1e12, 18, "tech")).toBeLessThanOrEqual(100);
  });

  it("quality moves towards its target, fast in tech and slowly in retail", () => {
    const techRate = BALANCE.sectors.tech.costStructure.qualityAdjustmentRate;
    expect(nextQuality(50, 0, 18, 0, "tech")).toBeCloseTo(50 * (1 - techRate), 9);
    expect(50 - nextQuality(50, 0, 18, 0, "retail")).toBeLessThan(50 - nextQuality(50, 0, 18, 0, "tech"));
    let q = 30;
    for (let i = 0; i < 400; i++) q = nextQuality(q, 12, 18, 0, "tech");
    expect(q).toBeCloseTo(qualityTarget(12, 18, "tech"), 3);
    expect(nextQuality(1, 0, 18, 0, "tech")).toBe(BALANCE.company.quality.min);
  });

  it("finished projects add quality", () => {
    expect(nextQuality(40, 0, 18, 10, "retail") - nextQuality(40, 0, 18, 0, "retail")).toBeCloseTo(10, 9);
    expect(nextQuality(99, 1e9, 18, 50, "retail")).toBe(100);
  });
});

describe("closeQuarter", () => {
  it("is deterministic and does not mutate its input", () => {
    const state = world([makePlayerCompany("startup", "tech")]);
    const before = serialize(state);
    const a = closeQuarter(state, [], createRng(5));
    const again = closeQuarter(state, [], createRng(5));
    expect(serialize(again)).toBe(serialize(a));
    expect(serialize(state)).toBe(before);
    expect(serialize(closeQuarter(state, [], createRng(6)))).not.toBe(serialize(a));
  });

  it("reports every active company and advances the quarter", () => {
    const state = world();
    const result = closeQuarter(state, [], createRng(1));
    expect(result.reports).toHaveLength(15);
    expect(result.sectors.map((s) => s.sectorId)).toEqual([...SECTOR_IDS]);
    for (const sector of result.sectors) expect(sector.segments.map((s) => s.segmentId)).toEqual([...SEGMENT_IDS]);
    expect(result.state.macro.quarterIndex).toBe(1);
    for (const c of result.state.companies) expect(c.quartersActive).toBe(1);
    for (const r of result.reports) expect(r.segmentId).toBe("international");
  });

  it("inside a segment shares sum to at most 1 and revenue never exceeds demand or capacity", () => {
    const players = [makePlayerCompany("a", "retail", "p1"), makePlayerCompany("b", "retail", "p2")];
    const result = closeQuarter(world(players), [], createRng(2));
    for (const sector of result.sectors) {
      for (const segment of sector.segments) {
        const reports = result.reports.filter(
          (r) =>
            r.segmentId === segment.segmentId &&
            result.state.companies.find((c) => c.id === r.companyId)?.sectorId === sector.sectorId,
        );
        const shareSum = reports.reduce((sum, r) => sum + r.marketShare, 0);
        const revenue = reports.reduce((sum, r) => sum + r.revenueCents, b(0));
        expect(shareSum).toBeLessThanOrEqual(1 + 1e-9);
        expect(
          revenue + segment.incumbentRevenueCents + segment.unservedDemandCents <= segment.demandCents + b(2),
        ).toBe(true);
        for (const r of reports) {
          expect(r.unitsSold).toBeLessThanOrEqual(r.capacityUnits * (1 + 1e-9));
          expect(r.segmentDemandCents).toBe(segment.demandCents);
        }
        if (segment.segmentId === "international") {
          expect(segment.incumbentRevenueCents).toBe(b(0));
          expect(reports.reduce((sum, r) => sum + r.attractivenessShare, 0)).toBeCloseTo(1, 9);
        }
      }
    }
  });

  it("a small business competes in its local market, not with the listed companies", () => {
    const withStartup = closeQuarter(world([makePlayerCompany("startup", "tech")]), [], createRng(3));
    const without = closeQuarter(world(), [], createRng(3));
    expect(reportOf(withStartup, "tech-blue")).toEqual(reportOf(without, "tech-blue"));
    const report = reportOf(withStartup, "startup");
    expect(report.segmentId).toBe("local");
    expect(Number(report.revenueCents)).toBeLessThan(segmentBaseDemand("tech", "local") * 1.3);
    const local = withStartup.sectors.find((s) => s.sectorId === "tech")?.segments.find((s) => s.segmentId === "local");
    expect((local?.incumbentRevenueCents ?? b(0)) > b(0)).toBe(true);
  });

  it("two small businesses in the same local market take customers from each other", () => {
    const alone = closeQuarter(world([makePlayerCompany("a", "retail", "p1")]), [], createRng(4));
    const crowded = closeQuarter(
      world([makePlayerCompany("a", "retail", "p1"), makePlayerCompany("b", "retail", "p2")]),
      [],
      createRng(4),
    );
    expect(reportOf(crowded, "a").attractivenessShare).toBeLessThan(reportOf(alone, "a").attractivenessShare);
    expect(reportOf(crowded, "a").revenueCents < reportOf(alone, "a").revenueCents).toBe(true);
    // A rival in another sector does not matter.
    const elsewhere = closeQuarter(
      world([makePlayerCompany("a", "retail", "p1"), makePlayerCompany("b", "tech", "p2")]),
      [],
      createRng(4),
    );
    expect(reportOf(elsewhere, "a")).toEqual(reportOf(alone, "a"));
  });

  it("books a consistent income statement", () => {
    const result = closeQuarter(world(), [], createRng(3));
    for (const r of result.reports) {
      const preTax =
        r.revenueCents - r.productionCostCents - r.payrollCents - r.fixedCostCents - r.marketingCents - r.interestCents;
      expect(r.netIncomeCents).toBe(preTax - r.taxCents);
      expect(r.taxCents >= b(0)).toBe(true);
      const company = result.state.companies.find((c) => c.id === r.companyId) as CompanyState;
      expect(company.cashCents).toBe(r.cashAfterCents);
    }
  });

  it("AI companies earn sector-typical margins", () => {
    const result = closeQuarter(world(), [], createRng(4));
    const margin = (id: string) => {
      const r = reportOf(result, id);
      return Number(r.netIncomeCents) / Number(r.revenueCents);
    };
    for (const s of SECTOR_IDS) {
      expect(margin(`${s}-blue`)).toBeGreaterThan(0.05);
      expect(margin(`${s}-blue`)).toBeLessThan(0.4);
    }
    // Retail lives on thin margins, tech and pharma on fat ones (spec 6.1).
    expect(margin("retail-blue")).toBeLessThan(margin("tech-blue"));
    expect(margin("retail-blue")).toBeLessThan(margin("pharma-blue"));
    expect(margin("logistics-blue")).toBeLessThan(margin("pharma-blue"));
  });

  it("a price cut wins share from every competitor (direct rivalry)", () => {
    const state = world();
    const reference = BALANCE.sectors.retail.costStructure.referencePriceCents;
    const cut: QuarterDecision[] = [{ companyId: "retail-mid", unitPriceCents: b(Math.round(reference * 0.85)) }];
    const baseline = closeQuarter(state, [], createRng(9));
    const withCut = closeQuarter(state, cut, createRng(9));
    expect(reportOf(withCut, "retail-mid").attractivenessShare).toBeGreaterThan(
      reportOf(baseline, "retail-mid").attractivenessShare,
    );
    expect(reportOf(withCut, "retail-blue").attractivenessShare).toBeLessThan(
      reportOf(baseline, "retail-blue").attractivenessShare,
    );
    expect(reportOf(withCut, "retail-penny").attractivenessShare).toBeLessThan(
      reportOf(baseline, "retail-penny").attractivenessShare,
    );
    // Revenue is not compared: a company at its capacity limit earns less per unit after a price cut,
    // which leaves more of the demand to the others (covered by the allocation tests).
    // Other sectors are untouched.
    expect(reportOf(withCut, "tech-blue")).toEqual(reportOf(baseline, "tech-blue"));
  });

  it("customers punish a higher price harder in retail than in pharma", () => {
    const lossOfShare = (sectorId: SectorId) => {
      const company = makePlayerCompany("x", sectorId);
      const reference = BALANCE.sectors[sectorId].costStructure.referencePriceCents;
      const normal = closeQuarter(world([company]), [], createRng(1));
      const pricey = closeQuarter(
        world([company]),
        [{ companyId: "x", unitPriceCents: b(reference * 2) }],
        createRng(1),
      );
      return reportOf(pricey, "x").attractivenessShare / reportOf(normal, "x").attractivenessShare;
    };
    expect(lossOfShare("retail")).toBeLessThan(lossOfShare("pharma"));
    expect(lossOfShare("pharma")).toBeLessThan(0.7);
  });

  it("clamps prices to the slider range", () => {
    const state = world();
    const result = closeQuarter(state, [{ companyId: "tech-blue", unitPriceCents: b(99_999_999) }], createRng(1));
    const company = result.state.companies.find((c) => c.id === "tech-blue") as CompanyState;
    expect(Number(company.unitPriceCents)).toBe(priceBandCents("tech").max);
  });

  it("marketing raises awareness, is spent as decided and works better with a marketing team", () => {
    const startup = makePlayerCompany("startup", "tech");
    const state = world([startup]);
    const awareness = (r: ReturnType<typeof closeQuarter>) =>
      (r.state.companies.find((c) => c.id === "startup") as CompanyState).awareness;
    const none = closeQuarter(state, [], createRng(1));
    const some = closeQuarter(state, [{ companyId: "startup", marketingBudgetCents: b(100_000) }], createRng(1));
    expect(awareness(none)).toBeCloseTo(
      startup.awareness * (1 - BALANCE.company.marketing.awarenessDecayPerQuarter),
      12,
    );
    expect(awareness(some)).toBeGreaterThan(startup.awareness);
    expect(reportOf(some, "startup").marketingCents).toBe(b(100_000));

    // A budget the cash cannot carry is still spent and leads into overdraft.
    const reckless = closeQuarter(state, [{ companyId: "startup", marketingBudgetCents: b(5_000_000) }], createRng(1));
    expect(reportOf(reckless, "startup").marketingCents).toBe(b(5_000_000));
    expect(reportOf(reckless, "startup").cashAfterCents < b(0)).toBe(true);
    expect(reportOf(reckless, "startup").graceQuartersLeft).toBe(BALANCE.company.insolvency.graceQuarters);

    const withTeam: CompanyState = {
      ...startup,
      departments: { ...startup.departments, marketing: { effectiveSkillPoints: 15, payrollCents: b(0) } },
    };
    const boosted = closeQuarter(
      world([withTeam]),
      [{ companyId: "startup", marketingBudgetCents: b(100_000) }],
      createRng(1),
    );
    expect(awareness(boosted)).toBeGreaterThan(awareness(some));
  });

  it("a small business with strong demand is capped by its production capacity", () => {
    const startup = { ...makePlayerCompany("startup", "tech"), awareness: 0.6, quality: 80 };
    const result = closeQuarter(world([startup]), [], createRng(1));
    const report = reportOf(result, "startup");
    expect(report.unitsSold).toBeCloseTo(report.capacityUnits, 6);
    expect(report.marketShare).toBeLessThan(report.attractivenessShare);
  });

  it("grants base XP for a profitable quarter of a player company only", () => {
    const profitable = { ...makePlayerCompany("good", "tech"), awareness: 0.4, quality: 55 };
    const result = closeQuarter(world([profitable]), [], createRng(1));
    expect(reportOf(result, "good").netIncomeCents > b(0)).toBe(true);
    expect(result.xpEvents).toEqual([
      { playerId: "player-1", kind: "profitable_company_quarter", xp: 500, companyId: "good" },
    ]);
  });

  it("checks guidance in both directions", () => {
    const company = { ...makePlayerCompany("guided", "tech"), awareness: 0.3 };
    const actual = reportOf(closeQuarter(world([company]), [], createRng(1)), "guided").revenueCents;
    const outcome = (guidance: bigint) =>
      closeQuarter(world([{ ...company, guidanceRevenueCents: guidance }]), [], createRng(1)).reputationEvents.map(
        (e) => e.kind,
      );
    expect(outcome(actual)).toEqual(["guidance_met"]);
    expect(outcome(actual * b(2))).toEqual(["guidance_missed"]);
    expect(outcome(actual / b(2))).toEqual(["guidance_missed"]);
    expect(outcome((actual * b(120)) / b(100))).toEqual([]);
  });

  it("stores the guidance for the next quarter", () => {
    const result = closeQuarter(
      world([makePlayerCompany("guided", "tech")]),
      [{ companyId: "guided", guidanceRevenueCents: b(123_456) }],
      createRng(1),
    );
    expect(result.state.companies.find((c) => c.id === "guided")?.guidanceRevenueCents).toBe(b(123_456));
  });

  it("pays a dividend only if the cash covers it", () => {
    const state = world();
    const paid = closeQuarter(state, [{ companyId: "tech-blue", dividendPerShareCents: b(10) }], createRng(1));
    const r = reportOf(paid, "tech-blue");
    expect(r.dividendTotalCents).toBe(b(100_000_000));
    const base = reportOf(closeQuarter(state, [], createRng(1)), "tech-blue");
    expect(r.cashAfterCents).toBe(base.cashAfterCents - b(100_000_000));

    const refused = closeQuarter(
      state,
      [{ companyId: "tech-blue", dividendPerShareCents: b(1_000_000) }],
      createRng(1),
    );
    expect(reportOf(refused, "tech-blue").dividendTotalCents).toBe(b(0));
  });

  it("gives a grace period of four quarter closes before insolvency", () => {
    const grace = BALANCE.company.insolvency.graceQuarters;
    expect(grace).toBe(4);
    const broke: CompanyState = {
      ...makePlayerCompany("broke", "energy"),
      cashCents: b(-500_000),
      awareness: BALANCE.company.marketing.minAwareness,
      listed: true,
    };
    let state = world([broke]);
    // Closes 1 to 4 with negative cash: warning with a countdown, still active.
    for (let close = 1; close <= grace; close++) {
      const result = closeQuarter(state, [], createRng(1));
      const company = result.state.companies.find((c) => c.id === "broke") as CompanyState;
      const report = reportOf(result, "broke");
      expect(company.status).toBe("active");
      expect(report.uncoveredQuarters).toBe(close);
      expect(report.graceQuartersLeft).toBe(grace + 1 - close);
      expect(report.becameInsolvent).toBe(false);
      expect(report.interestCents > b(0)).toBe(true); // overdraft interest
      expect(result.reputationEvents.some((e) => e.kind === "insolvency")).toBe(false);
      state = result.state;
    }
    // The fifth close in a row (24 real hours after the first) ends it.
    const last = closeQuarter(state, [], createRng(1));
    const after = last.state.companies.find((c) => c.id === "broke") as CompanyState;
    expect(after.status).toBe("insolvent");
    expect(reportOf(last, "broke")).toMatchObject({ becameInsolvent: true, graceQuartersLeft: 0 });
    expect(last.reputationEvents).toContainEqual({
      playerId: "player-1",
      companyId: "broke",
      kind: "insolvency",
      delta: BALANCE.reputation.deltas.insolvency,
    });
    expect(last.news.some((n) => n.templateKey === "company.insolvency" && n.companyId === "broke")).toBe(true);
    expect(last.shocks).toContainEqual({
      securityId: "broke",
      sentimentDelta: -1,
      priceReturn: BALANCE.company.insolvency.priceCrashReturn,
    });

    // Insolvent companies no longer take part.
    const next = closeQuarter(last.state, [], createRng(1));
    expect(next.reports.some((r) => r.companyId === "broke")).toBe(false);
  });

  it("ends the grace period as soon as the cash is positive again", () => {
    const company = { ...makeSectorCompanies("tech")[0], uncoveredQuarters: 3 } as CompanyState;
    const result = closeQuarter({ macro: makeMacro(), companies: [company] }, [], createRng(1));
    expect(result.state.companies[0]?.uncoveredQuarters).toBe(0);
    expect(result.reports[0]?.graceQuartersLeft).toBeNull();
  });

  it("publishes earnings news with a fair value for listed companies", () => {
    const first = closeQuarter(world([makePlayerCompany("private", "tech")]), [], createRng(1));
    const second = closeQuarter(first.state, [], createRng(1));
    const earnings = second.news.filter((n) => n.templateKey.startsWith("earnings."));
    expect(earnings).toHaveLength(15);
    expect(earnings.every((n) => n.companyId !== "private")).toBe(true);
    for (const r of second.reports) {
      if (r.companyId === "private") expect(r.fairValueE4).toBeNull();
      else expect((r.fairValueE4 as bigint) > b(0)).toBe(true);
    }
    for (const shock of second.shocks) expect(Math.abs(shock.sentimentDelta ?? 0)).toBeLessThanOrEqual(1);
  });

  it("fair value follows earnings: better results, higher anchor", () => {
    const state = world();
    const weak = closeQuarter(
      state,
      [{ companyId: "pharma-blue", unitPriceCents: b(priceBandCents("pharma").min) }],
      createRng(1),
    );
    const normal = closeQuarter(state, [], createRng(1));
    expect(
      (reportOf(weak, "pharma-blue").fairValueE4 as bigint) < (reportOf(normal, "pharma-blue").fairValueE4 as bigint),
    ).toBe(true);
  });
});

describe("AI economy over 40 quarters", () => {
  function runAi(seed: number, withMacroShocks: boolean) {
    const cfg = withMacroShocks
      ? BALANCE
      : {
          ...BALANCE,
          events: {
            ...BALANCE.events,
            macro: {
              sectorCrisis: { ...BALANCE.events.macro.sectorCrisis, probabilityPerQuarter: 0 },
              commodityShock: { ...BALANCE.events.macro.commodityShock, probabilityPerQuarter: 0 },
              recession: { ...BALANCE.events.macro.recession, probabilityPerQuarter: 0 },
              techBoom: { ...BALANCE.events.macro.techBoom, probabilityPerQuarter: 0 },
            },
          },
        };
    let state = world();
    const rng = createRng(seed);
    for (let q = 0; q < 40; q++) {
      const decisions = state.companies
        .filter((c) => c.status === "active")
        .map((c) => aiCompanyDecision(c, state.macro, rng.derive("ai", q, c.id), cfg));
      const result = closeQuarter(state, decisions, rng, cfg);
      state = {
        macro: result.state.macro,
        companies: result.state.companies.map((c) => {
          const report = result.reports.find((r) => r.companyId === c.id);
          return report && c.status === "active"
            ? aiAdjustStaffing(c, report.unitsSold / report.capacityUnits, cfg)
            : c;
        }),
      };
    }
    return state;
  }

  it("no AI company becomes insolvent without a macro shock, and none with the default shocks either", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const shocks of [false, true]) {
        const state = runAi(seed, shocks);
        expect(state.macro.quarterIndex).toBe(40);
        for (const c of state.companies) {
          expect(c.status, `${c.id} seed ${seed} shocks ${shocks}`).toBe("active");
          expect(c.cashCents > b(0), `${c.id} seed ${seed}`).toBe(true);
          expect(c.revenueHistoryCents.length).toBe(8);
          expect(c.awareness).toBeGreaterThan(0);
          expect(c.awareness).toBeLessThanOrEqual(1);
        }
        expect(state.macro.oilIndex).toBeGreaterThanOrEqual(BALANCE.events.oilReport.minIndex);
        expect(state.macro.cycleIndex).toBeLessThanOrEqual(BALANCE.events.businessCycle.maxIndex);
      }
    }
  });

  it("AI companies of a sector keep clearly different quality and stay ordered by size", () => {
    const state = runAi(3, false);
    for (const s of SECTOR_IDS) {
      const [blue, mid, penny] = ["blue", "mid", "penny"].map(
        (size) => state.companies.find((c) => c.id === `${s}-${size}`) as CompanyState,
      ) as [CompanyState, CompanyState, CompanyState];
      expect(blue.quality - mid.quality).toBeGreaterThan(5);
      expect(mid.quality - penny.quality).toBeGreaterThan(5);
      const revenue = (c: CompanyState) => c.revenueHistoryCents[c.revenueHistoryCents.length - 1] as bigint;
      expect(revenue(blue) > revenue(mid) && revenue(mid) > revenue(penny)).toBe(true);
    }
  });
});

describe("AI company policy", () => {
  it("prices near the reference, markets and pays out part of the profit", () => {
    const company: CompanyState = {
      ...(makeSectorCompanies("retail")[0] as CompanyState),
      revenueHistoryCents: [b(1_000_000_000)],
      netIncomeHistoryCents: [b(50_000_000), b(50_000_000), b(50_000_000), b(50_000_000)],
    };
    const decision = aiCompanyDecision(company, makeMacro(), createRng(1));
    const reference = BALANCE.sectors.retail.costStructure.referencePriceCents;
    expect(Number(decision.unitPriceCents)).toBeGreaterThan(reference * 0.9);
    expect(Number(decision.unitPriceCents)).toBeLessThan(reference * 1.1);
    expect(decision.marketingBudgetCents).toBe(b(12_000_000));
    // 200 M cents trailing x 60 % / 4 quarters / 10 M shares = 3 cents per share
    expect(decision.dividendPerShareCents).toBe(b(3));
  });

  it("passes higher oil costs on to the price", () => {
    const company = makeSectorCompanies("logistics")[0] as CompanyState;
    const calm = aiCompanyDecision(company, makeMacro(), createRng(1));
    const shock = aiCompanyDecision(company, makeMacro({ oilIndex: 1.5 }), createRng(1));
    expect((shock.unitPriceCents as bigint) > (calm.unitPriceCents as bigint)).toBe(true);
  });

  it("pays no dividend after losses", () => {
    const company: CompanyState = {
      ...(makeSectorCompanies("retail")[0] as CompanyState),
      netIncomeHistoryCents: [b(-5)],
    };
    expect(aiCompanyDecision(company, makeMacro(), createRng(1)).dividendPerShareCents).toBe(b(0));
  });

  it("hires at high utilisation and shrinks at low utilisation", () => {
    const company = makeSectorCompanies("tech")[0] as CompanyState;
    const points = company.departments.production.effectiveSkillPoints;
    expect(aiAdjustStaffing(company, 0.99).departments.production.effectiveSkillPoints).toBeGreaterThan(points);
    expect(aiAdjustStaffing(company, 0.5).departments.production.effectiveSkillPoints).toBeLessThan(points);
    expect(aiAdjustStaffing(company, 0.9)).toBe(company);
    expect(
      aiAdjustStaffing(company, 0.99).departments.production.payrollCents > company.departments.production.payrollCents,
    ).toBe(true);
  });
});
