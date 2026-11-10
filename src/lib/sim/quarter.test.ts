import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import type { SectorId } from "../../config/balance.ts";
import { SECTOR_IDS } from "./events.ts";
import {
  aiAdjustStaffing,
  aiCompanyDecision,
  closeQuarter,
  nextQuality,
  priceBandCents,
  sectorDemand,
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

describe("company helpers", () => {
  it("scales fixed costs with the capital intensity of the sector", () => {
    expect(tierFixedCostCents("small_business", "retail")).toBe(b(200_000));
    expect(tierFixedCostCents("small_business", "energy")).toBe(b(400_000));
    expect(tierFixedCostCents("gmbh", "tech")).toBe(b(600_000));
  });

  it("keeps the price band around the reference price", () => {
    for (const s of SECTOR_IDS) {
      const band = priceBandCents(s);
      const cost = BALANCE.sectors[s].costStructure;
      expect(band.min).toBeLessThan(cost.referencePriceCents);
      expect(band.max).toBeGreaterThan(cost.referencePriceCents);
      expect(band.max).toBeGreaterThan(cost.unitCostCents);
    }
  });

  it("quality decays without development and saturates with it", () => {
    expect(nextQuality(50, 0, 0, "tech")).toBe(50 - BALANCE.sectors.tech.costStructure.qualityDecayPerQuarter);
    expect(nextQuality(50, 30, 0, "tech")).toBeGreaterThan(50);
    expect(nextQuality(99, 1e9, 50, "retail")).toBe(100);
    expect(nextQuality(1, 0, 0, "tech")).toBe(1);
    let q = 30;
    for (let i = 0; i < 400; i++) q = nextQuality(q, 1e9, 0, "tech");
    expect(q).toBeGreaterThan(60);
    expect(q).toBeLessThan(80);
  });

  it("finished projects add quality", () => {
    expect(nextQuality(40, 0, 10, "retail")).toBeCloseTo(49.5, 9);
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
    expect(result.state.macro.quarterIndex).toBe(1);
    for (const c of result.state.companies) expect(c.quartersActive).toBe(1);
  });

  it("market shares of a sector sum to at most 1 and revenue never exceeds demand or capacity", () => {
    const result = closeQuarter(world([makePlayerCompany("startup", "retail")]), [], createRng(2));
    for (const sector of result.sectors) {
      const companies = result.state.companies.filter((c) => c.sectorId === sector.sectorId);
      const reports = companies.map((c) => reportOf(result, c.id));
      const shareSum = reports.reduce((sum, r) => sum + r.marketShare, 0);
      const attractivenessSum = reports.reduce((sum, r) => sum + r.attractivenessShare, 0);
      const revenue = reports.reduce((sum, r) => sum + r.revenueCents, b(0));
      expect(shareSum).toBeLessThanOrEqual(1 + 1e-9);
      expect(attractivenessSum).toBeCloseTo(1, 9);
      expect(revenue + sector.unservedDemandCents <= sector.demandCents + b(1)).toBe(true);
      for (const r of reports) expect(r.unitsSold).toBeLessThanOrEqual(r.capacityUnits * (1 + 1e-9));
    }
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
      expect(margin(`${s}-blue`)).toBeGreaterThan(0.02);
      expect(margin(`${s}-blue`)).toBeLessThan(0.4);
    }
    // Retail lives on thin margins, tech and pharma on fat ones (spec 6.1).
    expect(margin("retail-blue")).toBeLessThan(margin("tech-blue"));
    expect(margin("retail-blue")).toBeLessThan(margin("pharma-blue"));
  });

  it("a price cut wins revenue from the competitors (direct rivalry)", () => {
    const state = world();
    const reference = BALANCE.sectors.retail.costStructure.referencePriceCents;
    const cut: QuarterDecision[] = [{ companyId: "retail-mid", unitPriceCents: b(Math.round(reference * 0.85)) }];
    const baseline = closeQuarter(state, [], createRng(9));
    const withCut = closeQuarter(state, cut, createRng(9));
    expect(reportOf(withCut, "retail-mid").attractivenessShare).toBeGreaterThan(
      reportOf(baseline, "retail-mid").attractivenessShare,
    );
    expect(reportOf(withCut, "retail-blue").revenueCents < reportOf(baseline, "retail-blue").revenueCents).toBe(true);
    expect(reportOf(withCut, "retail-penny").attractivenessShare).toBeLessThan(
      reportOf(baseline, "retail-penny").attractivenessShare,
    );
    // Other sectors are untouched.
    expect(reportOf(withCut, "tech-blue")).toEqual(reportOf(baseline, "tech-blue"));
  });

  it("clamps prices to the allowed band", () => {
    const state = world();
    const result = closeQuarter(state, [{ companyId: "tech-blue", unitPriceCents: b(99_999_999) }], createRng(1));
    const company = result.state.companies.find((c) => c.id === "tech-blue") as CompanyState;
    expect(Number(company.unitPriceCents)).toBe(priceBandCents("tech").max);
  });

  it("marketing raises awareness and is limited by cash", () => {
    const startup = makePlayerCompany("startup", "tech");
    const state = world([startup]);
    const none = closeQuarter(state, [], createRng(1));
    const some = closeQuarter(state, [{ companyId: "startup", marketingBudgetCents: b(200_000) }], createRng(1));
    const greedy = closeQuarter(state, [{ companyId: "startup", marketingBudgetCents: b(999_999_999) }], createRng(1));
    const awareness = (r: typeof none) => (r.state.companies.find((c) => c.id === "startup") as CompanyState).awareness;
    expect(awareness(some)).toBeGreaterThan(awareness(none));
    expect(reportOf(some, "startup").marketingCents).toBe(b(200_000));
    expect(reportOf(greedy, "startup").marketingCents).toBe(b(750_000)); // 50 % of 15 000 EUR cash
  });

  it("a small business is capped by its production capacity", () => {
    const startup = { ...makePlayerCompany("startup", "tech"), awareness: 0.2, quality: 70 };
    const result = closeQuarter(world([startup]), [], createRng(1));
    const report = reportOf(result, "startup");
    expect(report.unitsSold).toBeCloseTo(report.capacityUnits, 6);
    expect(report.marketShare).toBeLessThan(report.attractivenessShare);
  });

  it("grants XP for a profitable quarter of a player company only", () => {
    const profitable = {
      ...makePlayerCompany("good", "tech"),
      awareness: 0.05,
      unitPriceCents: b(priceBandCents("tech").max),
    };
    const result = closeQuarter(world([profitable]), [], createRng(1));
    expect(reportOf(result, "good").netIncomeCents > b(0)).toBe(true);
    expect(result.xpEvents).toEqual([
      { playerId: "player-1", kind: "profitable_company_quarter", xp: 500, companyId: "good" },
    ]);
  });

  it("checks guidance in both directions", () => {
    const company = { ...makePlayerCompany("guided", "tech"), awareness: 0.05 };
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

  it("declares insolvency after two uncovered quarters", () => {
    const broke: CompanyState = {
      ...makePlayerCompany("broke", "energy"),
      cashCents: b(-500_000),
      awareness: BALANCE.company.marketing.minAwareness,
      listed: true,
    };
    const first = closeQuarter(world([broke]), [], createRng(1));
    const afterFirst = first.state.companies.find((c) => c.id === "broke") as CompanyState;
    expect(afterFirst.uncoveredQuarters).toBe(1);
    expect(afterFirst.status).toBe("active");
    expect(reportOf(first, "broke").interestCents > b(0)).toBe(true); // overdraft interest

    const second = closeQuarter(first.state, [], createRng(1));
    const afterSecond = second.state.companies.find((c) => c.id === "broke") as CompanyState;
    expect(afterSecond.status).toBe("insolvent");
    expect(reportOf(second, "broke").becameInsolvent).toBe(true);
    expect(second.reputationEvents).toContainEqual({
      playerId: "player-1",
      companyId: "broke",
      kind: "insolvency",
      delta: BALANCE.reputation.deltas.insolvency,
    });
    expect(second.news.some((n) => n.templateKey === "company.insolvency" && n.companyId === "broke")).toBe(true);
    expect(second.shocks).toContainEqual({
      securityId: "broke",
      sentimentDelta: -1,
      priceReturn: BALANCE.company.insolvency.priceCrashReturn,
    });

    // Insolvent companies no longer take part.
    const third = closeQuarter(second.state, [], createRng(1));
    expect(third.reports.some((r) => r.companyId === "broke")).toBe(false);
  });

  it("resets the insolvency counter once costs are covered again", () => {
    const company = { ...makeSectorCompanies("tech")[0], uncoveredQuarters: 1 } as CompanyState;
    const result = closeQuarter({ macro: makeMacro(), companies: [company] }, [], createRng(1));
    expect(result.state.companies[0]?.uncoveredQuarters).toBe(0);
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

  it("keeps at most eight quarters of history and stays healthy over two game years", () => {
    let state = world([makePlayerCompany("startup", "retail")]);
    const rng = createRng(21);
    for (let q = 0; q < 12; q++) {
      const decisions = state.companies.map((c) =>
        c.isPlayerCompany
          ? { companyId: c.id, unitPriceCents: b(priceBandCents(c.sectorId).max), marketingBudgetCents: b(100_000) }
          : aiCompanyDecision(c, state.macro, rng.derive("ai", q, c.id)),
      );
      const result = closeQuarter(state, decisions, rng);
      state = {
        macro: result.state.macro,
        companies: result.state.companies.map((c) => {
          const report = result.reports.find((r) => r.companyId === c.id);
          return !c.isPlayerCompany && report ? aiAdjustStaffing(c, report.unitsSold / report.capacityUnits) : c;
        }),
      };
    }
    expect(state.macro.quarterIndex).toBe(12);
    for (const c of state.companies) {
      expect(c.revenueHistoryCents.length).toBe(8);
      expect(c.status).toBe("active");
      expect(c.quality).toBeGreaterThanOrEqual(BALANCE.company.quality.min);
      expect(c.awareness).toBeGreaterThan(0);
      expect(c.awareness).toBeLessThanOrEqual(1);
    }
    expect(state.macro.oilIndex).toBeGreaterThanOrEqual(BALANCE.events.oilReport.minIndex);
    expect(state.macro.cycleIndex).toBeLessThanOrEqual(BALANCE.events.businessCycle.maxIndex);
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
