/**
 * Scenario harness for the company simulation (not part of the public API).
 *
 * Runs `closeQuarter` for player companies managed by scripted founder
 * archetypes and reports profit, payback and insolvency. It is the tool behind
 * the balancing targets "a company must pay off, but not everyone may succeed"
 * (docs/BALANCING.md section 4) and is used by `company-scenarios.test.ts`.
 *
 * The harness models individual employees (hiring, onboarding, salaries) with
 * the real functions from `employees.ts`, exactly as the database will.
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig, CompanyTierId, DepartmentId, SectorId } from "../../config/balance.ts";
import { effectiveSkillPoints, marketSalaryCents } from "./employees.ts";
import {
  awarenessAfterTierChange,
  closeQuarter,
  marketPriceCents,
  priceBandCents,
  qualityTarget,
  segmentBaseDemand,
  segmentForTier,
  tierFixedCostCents,
  unitCostCents,
} from "./quarter.ts";
import { createRng } from "./rng.ts";
import type {
  CompanyQuarterReport,
  CompanyState,
  DepartmentState,
  MacroState,
  QuarterDecision,
  QuarterState,
} from "./types.ts";

export type Archetype =
  /** Default price, no marketing, no development, starter team only. */
  | "passive"
  /** Sells far below the market price, markets, hires production when sold out. */
  | "dumper"
  /** Always the highest price, no marketing, no development. */
  | "greedy"
  /** Matches staff to demand, steady marketing, invests in quality, passes costs on. */
  | "solid"
  /** Hires to the cap immediately and maxes the marketing budget. */
  | "over_expander"
  /** Like solid, but no developers, little marketing, never adjusts the price, never lays off. */
  | "mediocre"
  /** Overstaffed from day one, overpriced, hardly any marketing. */
  | "sloppy";

interface Employee {
  readonly department: DepartmentId;
  readonly skill: number;
  quartersEmployed: number;
}

export interface ScenarioOptions {
  readonly sectorId: SectorId;
  readonly tier: CompanyTierId;
  /** One player company per entry, all in the same sector and segment. */
  readonly archetypes: readonly Archetype[];
  readonly quarters: number;
  readonly seed: number;
  readonly cfg?: BalanceConfig;
}

export interface ScenarioOutcome {
  readonly archetype: Archetype;
  readonly sectorId: SectorId;
  readonly tier: CompanyTierId;
  readonly foundingCostCents: number;
  /** Net income per quarter in cents while the company was active. */
  readonly netIncomeCents: readonly number[];
  readonly cumulativeProfitCents: number;
  readonly finalCashCents: number;
  /** First quarter (1-based) at whose close the cumulative profit covers the founding cost, or `null`. */
  readonly paybackQuarter: number | null;
  /** Quarter (1-based) at whose close the company became insolvent, or `null`. */
  readonly insolventAtQuarter: number | null;
  /** First quarter (1-based) that closed with negative cash, or `null`. */
  readonly firstNegativeCashQuarter: number | null;
  /** Mean net income of the last 8 quarters in cents, `null` if insolvent before the end. */
  readonly steadyProfitCentsPerQuarter: number | null;
  /** Mean net income of quarters 9 to 16 in cents (is the company bleeding by day 3 and 4?). */
  readonly midProfitCentsPerQuarter: number | null;
  readonly finalHeadcount: number;
  readonly finalQuality: number;
  readonly finalAwareness: number;
  readonly finalMarketShare: number;
}

const SKILL = 5;
/** Awareness of a well-run company in its old segment at the moment it converts to the next tier. */
const CONVERTED_AWARENESS = 0.34;

interface Firm {
  readonly id: string;
  readonly archetype: Archetype;
  employees: Employee[];
  lastReport: CompanyQuarterReport | null;
  readonly net: number[];
  insolventAt: number | null;
  firstNegative: number | null;
}

function departments(employees: readonly Employee[], cfg: BalanceConfig): Record<DepartmentId, DepartmentState> {
  const result: Record<DepartmentId, { effectiveSkillPoints: number; payrollCents: bigint }> = {
    development: { effectiveSkillPoints: 0, payrollCents: BigInt(0) },
    sales: { effectiveSkillPoints: 0, payrollCents: BigInt(0) },
    production: { effectiveSkillPoints: 0, payrollCents: BigInt(0) },
    finance: { effectiveSkillPoints: 0, payrollCents: BigInt(0) },
    marketing: { effectiveSkillPoints: 0, payrollCents: BigInt(0) },
  };
  for (const e of employees) {
    const d = result[e.department];
    d.effectiveSkillPoints += effectiveSkillPoints(
      { skill: e.skill, quartersEmployed: e.quartersEmployed, traitKey: null, isPlayer: false },
      cfg.employees,
      cfg.company.onboardingRamp,
    );
    d.payrollCents += marketSalaryCents(e.skill, null, cfg.employees);
  }
  return result;
}

function count(employees: readonly Employee[], department: DepartmentId): number {
  return employees.filter((e) => e.department === department).length;
}

function hire(firm: Firm, department: DepartmentId, n: number, cap: number): void {
  for (let i = 0; i < n && firm.employees.length < cap; i++) {
    firm.employees.push({ department, skill: SKILL, quartersEmployed: 0 });
  }
}

/** Lays off the most recently hired employees of a department, keeping at least `keep`. */
function fire(firm: Firm, department: DepartmentId, n: number, keep: number): void {
  for (let i = 0; i < n && count(firm.employees, department) > keep; i++) {
    const index = firm.employees.map((e) => e.department).lastIndexOf(department);
    firm.employees.splice(index, 1);
  }
}

/** Developers a careful founder hires: enough to beat the established suppliers' quality by 10 points. */
function developersNeeded(
  sectorId: SectorId,
  tier: CompanyTierId,
  productionHeadcount: number,
  cap: number,
  cfg: BalanceConfig,
): number {
  const perHead = effectiveSkillPoints(
    { skill: SKILL, quartersEmployed: 9, traitKey: null, isPlayer: false },
    cfg.employees,
  );
  const goal = cfg.company.segments[segmentForTier(tier, cfg)].incumbentQuality + 10;
  const max = Math.max(1, Math.floor(cap * 0.4));
  for (let devs = 1; devs <= max; devs++) {
    if (qualityTarget(devs * perHead, productionHeadcount * perHead, sectorId, cfg) >= goal) return devs;
  }
  return max;
}

/** Runs one scenario and returns one outcome per company. */
export function runScenario(options: ScenarioOptions): ScenarioOutcome[] {
  const cfg = options.cfg ?? BALANCE;
  const { sectorId, tier, quarters } = options;
  const tierCfg = cfg.company.tiers.find((t) => t.id === tier);
  if (!tierCfg) throw new RangeError(`unknown tier: ${tier}`);
  const cap = tierCfg.maxEmployees;
  const step = Math.max(1, Math.round(cap * 0.1));
  // A small business starts with three trained production workers. Larger tiers start as a converted
  // company of the tier below: its full team (20 % developers, the rest production), its quality and
  // the customers who already know it.
  const tierIndex = cfg.company.tiers.findIndex((t) => t.id === tier);
  const previousTier = tierIndex > 0 ? cfg.company.tiers[tierIndex - 1] : undefined;
  const starterDevelopers = previousTier ? Math.max(1, Math.round(previousTier.maxEmployees * 0.2)) : 0;
  const starter = previousTier ? previousTier.maxEmployees - starterDevelopers : 3;
  const startQuality = previousTier
    ? cfg.company.segments[segmentForTier(previousTier.id, cfg)].incumbentQuality + 10
    : cfg.company.quality.initial;
  const startAwareness = previousTier
    ? awarenessAfterTierChange(CONVERTED_AWARENESS, previousTier.id, tier, cfg)
    : cfg.company.marketing.initialAwareness;
  const segmentId = segmentForTier(tier, cfg);
  const referenceBudget =
    segmentBaseDemand(sectorId, segmentId, cfg) * cfg.company.marketing.referenceBudgetShareOfSegmentDemand;
  const band = priceBandCents(sectorId, cfg);
  const referencePrice = cfg.sectors[sectorId].costStructure.referencePriceCents;
  // Founders put in the founding cost once more as working capital (the cap is twice the founding cost).
  const startCash = BigInt(tierCfg.foundingCostCents);

  const firms: Firm[] = options.archetypes.map((archetype, i) => {
    const firm: Firm = {
      id: `${archetype}-${i}`,
      archetype,
      employees: [],
      lastReport: null,
      net: [],
      insolventAt: null,
      firstNegative: null,
    };
    hire(firm, "production", starter, cap);
    hire(firm, "development", starterDevelopers, cap);
    const starterSize = firm.employees.length;
    for (const e of firm.employees) e.quartersEmployed = 9; // the starter team is already trained
    if (archetype === "solid") {
      const devs = developersNeeded(sectorId, tier, starter, cap, cfg) - starterDevelopers;
      // Make room for the developers inside the head count cap.
      fire(firm, "production", Math.max(0, starterSize + devs - cap), 1);
      hire(firm, "development", Math.max(0, devs), cap);
    }
    if (archetype === "over_expander") {
      hire(firm, "development", Math.round(cap * 0.2), cap);
      hire(firm, "production", cap, cap);
    }
    if (archetype === "sloppy") hire(firm, "production", cap, cap);
    return firm;
  });

  let state: QuarterState = {
    macro: {
      quarterIndex: 0,
      policyRateBps: cfg.centralBank.startRateBps,
      oilIndex: 1,
      cycleIndex: 1,
      activeEffects: [],
    },
    companies: firms.map((firm): CompanyState => ({
      id: firm.id,
      sectorId,
      tier,
      status: "active",
      isPlayerCompany: true,
      founderId: `founder-${firm.id}`,
      founderReputation: cfg.reputation.start,
      listed: false,
      cashCents: startCash,
      debtCents: BigInt(0),
      loanRateBps: 0,
      bookEquityCents: startCash,
      sharesOutstanding: BigInt(1_000),
      quality: startQuality,
      awareness: startAwareness,
      unitPriceCents: BigInt(referencePrice),
      fixedCostCents: tierFixedCostCents(tier, sectorId, cfg),
      departments: departments(firm.employees, cfg),
      leadership: { cfo: 0, cto: 0, coo: 0, headOfSales: 0 },
      projects: [],
      guidanceRevenueCents: null,
      uncoveredQuarters: 0,
      quartersActive: 0,
      revenueHistoryCents: [],
      netIncomeHistoryCents: [],
      eventValueFactor: 1,
    })),
  };

  const rng = createRng(options.seed);
  const lastShare = new Map<string, number>();

  for (let q = 0; q < quarters; q++) {
    const decisions: QuarterDecision[] = [];
    for (const firm of firms) {
      if (firm.insolventAt !== null) continue;
      const company = state.companies.find((c) => c.id === firm.id) as CompanyState;
      decisions.push(decide(firm, company, state.macro, { cap, step, referenceBudget, band, referencePrice, cfg }));
    }
    // Staffing decided above takes effect in this quarter.
    state = {
      macro: state.macro,
      companies: state.companies.map((c) => {
        const firm = firms.find((f) => f.id === c.id) as Firm;
        return c.status === "active" ? { ...c, departments: departments(firm.employees, cfg) } : c;
      }),
    };
    const result = closeQuarter(state, decisions, rng, cfg);
    state = result.state;
    for (const firm of firms) {
      const report = result.reports.find((r) => r.companyId === firm.id);
      if (!report) continue;
      firm.lastReport = report;
      firm.net.push(Number(report.netIncomeCents));
      lastShare.set(firm.id, report.marketShare);
      if (report.cashAfterCents < BigInt(0) && firm.firstNegative === null) firm.firstNegative = q + 1;
      if (report.becameInsolvent) firm.insolventAt = q + 1;
      for (const e of firm.employees) e.quartersEmployed++;
    }
  }

  return firms.map((firm): ScenarioOutcome => {
    const company = state.companies.find((c) => c.id === firm.id) as CompanyState;
    let cumulative = 0;
    let payback: number | null = null;
    firm.net.forEach((n, i) => {
      cumulative += n;
      if (payback === null && cumulative >= tierCfg.foundingCostCents) payback = i + 1;
    });
    const mean = (values: readonly number[]) => values.reduce((a, v) => a + v, 0) / values.length;
    const alive = firm.insolventAt === null;
    return {
      archetype: firm.archetype,
      sectorId,
      tier,
      foundingCostCents: tierCfg.foundingCostCents,
      netIncomeCents: firm.net,
      cumulativeProfitCents: cumulative,
      finalCashCents: Number(company.cashCents),
      paybackQuarter: payback,
      insolventAtQuarter: firm.insolventAt,
      firstNegativeCashQuarter: firm.firstNegative,
      steadyProfitCentsPerQuarter: alive && firm.net.length >= 8 ? mean(firm.net.slice(-8)) : null,
      midProfitCentsPerQuarter: firm.net.length >= 16 ? mean(firm.net.slice(8, 16)) : null,
      finalHeadcount: firm.employees.length,
      finalQuality: company.quality,
      finalAwareness: company.awareness,
      finalMarketShare: lastShare.get(firm.id) ?? 0,
    };
  });
}

interface PolicyContext {
  readonly cap: number;
  readonly step: number;
  readonly referenceBudget: number;
  readonly band: { readonly min: number; readonly max: number };
  readonly referencePrice: number;
  readonly cfg: BalanceConfig;
}

/** Decision of one founder archetype for the coming quarter (may hire or lay off). */
function decide(firm: Firm, company: CompanyState, macro: MacroState, ctx: PolicyContext): QuarterDecision {
  const { cap, step, referenceBudget, band, referencePrice, cfg } = ctx;
  const report = firm.lastReport;
  const utilization = report && report.capacityUnits > 0 ? report.unitsSold / report.capacityUnits : null;
  const marketPrice = Math.round(marketPriceCents(company.sectorId, macro.oilIndex, cfg));
  const budget = (factor: number) => BigInt(Math.round(referenceBudget * factor));
  const price = (cents: number) => BigInt(Math.round(cents));
  const perHead = effectiveSkillPoints(
    { skill: SKILL, quartersEmployed: 9, traitKey: null, isPlayer: false },
    cfg.employees,
  );
  const wagePerUnit =
    Number(marketSalaryCents(SKILL, null, cfg.employees)) /
    (perHead * cfg.sectors[company.sectorId].costStructure.capacityUnitsPerSkillPoint);
  const variableUnitCost = unitCostCents(company.sectorId, macro.oilIndex, cfg) + wagePerUnit;
  const onboarding = firm.employees.some((e) => e.quartersEmployed < cfg.company.onboardingRamp.length);

  switch (firm.archetype) {
    case "passive":
      return { companyId: firm.id, unitPriceCents: price(referencePrice), marketingBudgetCents: BigInt(0) };

    case "greedy":
      return { companyId: firm.id, unitPriceCents: price(band.max), marketingBudgetCents: BigInt(0) };

    case "dumper":
      if (utilization !== null && utilization > 0.95 && !onboarding) hire(firm, "production", step, cap);
      // Sells 5 % above its own variable cost (materials plus production wages per unit).
      return { companyId: firm.id, unitPriceCents: price(variableUnitCost * 1.05), marketingBudgetCents: budget(1) };

    case "over_expander":
      // Ten times the budget of a careful founder (the simulation limits it to half of the cash).
      return { companyId: firm.id, unitPriceCents: price(marketPrice), marketingBudgetCents: budget(10) };

    case "sloppy":
      return { companyId: firm.id, unitPriceCents: price(referencePrice * 1.25), marketingBudgetCents: budget(0.2) };

    case "mediocre":
      if (utilization !== null && utilization > 0.95 && !onboarding) hire(firm, "production", step, cap);
      return { companyId: firm.id, unitPriceCents: price(referencePrice), marketingBudgetCents: budget(0.4) };

    case "solid": {
      if (utilization !== null) {
        if (utilization > 0.95) {
          // Grow production, and development with it so that quality keeps up with the size.
          const production = count(firm.employees, "production");
          const wanted = developersNeeded(company.sectorId, company.tier, production + step, cap, cfg);
          hire(firm, "development", wanted - count(firm.employees, "development"), cap);
          hire(firm, "production", step, cap);
        } else if (utilization < 0.75 && !onboarding) fire(firm, "production", step, 1);
      }
      return { companyId: firm.id, unitPriceCents: price(marketPrice), marketingBudgetCents: budget(1) };
    }
  }
}

// ------------------------------------------------------------- aggregation

export interface ScenarioSummary {
  readonly runs: number;
  readonly medianCumulativeProfitCents: number;
  readonly medianSteadyProfitCentsPerQuarter: number | null;
  readonly medianPaybackQuarter: number | null;
  /** Share of runs that paid back the founding cost inside the run. */
  readonly paybackRate: number;
  readonly insolvencyRate: number;
  readonly medianInsolventAtQuarter: number | null;
  readonly earliestInsolventAtQuarter: number | null;
  /** Share of runs with a positive cumulative profit at the end. */
  readonly profitableRate: number;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function summarize(outcomes: readonly ScenarioOutcome[]): ScenarioSummary {
  const insolvent = outcomes.map((o) => o.insolventAtQuarter).filter((q): q is number => q !== null);
  const payback = outcomes.map((o) => o.paybackQuarter).filter((q): q is number => q !== null);
  const steady = outcomes.map((o) => o.steadyProfitCentsPerQuarter).filter((p): p is number => p !== null);
  return {
    runs: outcomes.length,
    medianCumulativeProfitCents: median(outcomes.map((o) => o.cumulativeProfitCents)) ?? 0,
    medianSteadyProfitCentsPerQuarter: median(steady),
    medianPaybackQuarter: payback.length * 2 > outcomes.length ? median(payback) : null,
    paybackRate: payback.length / outcomes.length,
    insolvencyRate: insolvent.length / outcomes.length,
    medianInsolventAtQuarter: median(insolvent),
    earliestInsolventAtQuarter: insolvent.length > 0 ? Math.min(...insolvent) : null,
    profitableRate: outcomes.filter((o) => o.cumulativeProfitCents > 0).length / outcomes.length,
  };
}
