/**
 * Fixtures for the unit tests (not part of the public API).
 */
import { BALANCE } from "../../config/balance.ts";
import type { SectorId, SizeClass } from "../../config/balance.ts";
import { bondYieldBps } from "./bonds.ts";
import { effectiveSkillPoints, marketSalaryCents } from "./employees.ts";
import { initialArchetypeStates } from "./investors.ts";
import { tierFixedCostCents } from "./quarter.ts";
import type { CompanyState, DepartmentState, MacroState, SecurityState } from "./types.ts";

export function makeSecurity(overrides: Partial<SecurityState> & { id: string }): SecurityState {
  const freeFloatShares = overrides.freeFloatShares ?? BigInt(10_000_000);
  const priceE4 = overrides.priceE4 ?? BigInt(1_000_000);
  const inIndex = overrides.inIndex ?? true;
  const dividendYieldBps = overrides.dividendYieldBps ?? 300;
  return {
    sectorId: "retail",
    sizeClass: "bluechip" as SizeClass,
    priceE4,
    fairValueE4: priceE4,
    sharesOutstanding: freeFloatShares * BigInt(2),
    freeFloatShares,
    sentiment: 0,
    emaFastE4: Number(priceE4),
    emaSlowE4: Number(priceE4),
    dividendYieldBps,
    inIndex,
    halted: false,
    archetypes: initialArchetypeStates({
      freeFloatShares: Number(freeFloatShares),
      policyRateBps: BALANCE.centralBank.startRateBps,
      dividendYieldBps,
      bondYieldBps: bondYieldBps(BALANCE.centralBank.startRateBps, 10),
      inIndex,
    }),
    ...overrides,
  };
}

const SKILL_5_POINTS = effectiveSkillPoints({ skill: 5, quartersEmployed: 9, traitKey: null, isPlayer: false });
const SKILL_5_SALARY = marketSalaryCents(5);

/** A department of `headcount` fully onboarded skill-5 employees. */
export function makeDepartment(headcount: number): DepartmentState {
  return {
    effectiveSkillPoints: headcount * SKILL_5_POINTS,
    payrollCents: SKILL_5_SALARY * BigInt(Math.round(headcount)),
  };
}

/**
 * A listed AI company sized for `share` of its sector's baseline demand.
 * `developmentRatio` is development staff relative to production staff before
 * the sector's development intensity; it decides the quality the company can hold.
 */
export function makeAiCompany(
  id: string,
  sectorId: SectorId,
  share: number,
  quality: number,
  awareness: number,
  developmentRatio = 0.1,
): CompanyState {
  const sector = BALANCE.sectors[sectorId];
  const revenue = sector.baseDemandCentsPerQuarter * share;
  const production =
    (revenue /
      sector.costStructure.referencePriceCents /
      sector.costStructure.capacityUnitsPerSkillPoint /
      SKILL_5_POINTS) *
    1.1;
  return {
    id,
    sectorId,
    tier: "listed",
    status: "active",
    isPlayerCompany: false,
    founderId: null,
    founderReputation: null,
    listed: true,
    cashCents: BigInt(Math.round(revenue * 0.5)),
    debtCents: BigInt(0),
    loanRateBps: 500,
    bookEquityCents: BigInt(Math.round(revenue * 2)),
    sharesOutstanding: BigInt(10_000_000),
    quality,
    awareness,
    unitPriceCents: BigInt(sector.costStructure.referencePriceCents),
    fixedCostCents: BigInt(Math.round(revenue * 0.06 * sector.costStructure.fixedCostMultiplier)),
    departments: {
      production: makeDepartment(production),
      development: makeDepartment(production * developmentRatio * sector.costStructure.developmentIntensity),
      sales: makeDepartment(production * 0.05),
      finance: makeDepartment(production * 0.02),
      marketing: makeDepartment(production * 0.02),
    },
    leadership: { cfo: 6, cto: 6, coo: 0, headOfSales: 0 },
    projects: [],
    guidanceRevenueCents: null,
    uncoveredQuarters: 0,
    quartersActive: 0,
    revenueHistoryCents: [],
    netIncomeHistoryCents: [],
    eventValueFactor: 1,
  };
}

/** A freshly founded small business of a player: 3 production, 1 development, 1 sales. */
export function makePlayerCompany(id: string, sectorId: SectorId, founderId = "player-1"): CompanyState {
  return {
    ...makeAiCompany(id, sectorId, 0, BALANCE.company.quality.initial, BALANCE.company.marketing.initialAwareness),
    tier: "small_business",
    isPlayerCompany: true,
    founderId,
    founderReputation: BALANCE.reputation.start,
    listed: false,
    cashCents: BigInt(1_500_000),
    bookEquityCents: BigInt(1_500_000),
    sharesOutstanding: BigInt(1_000),
    fixedCostCents: tierFixedCostCents("small_business", sectorId),
    departments: {
      production: makeDepartment(3),
      development: makeDepartment(1),
      sales: makeDepartment(1),
      finance: makeDepartment(0),
      marketing: makeDepartment(0),
    },
    leadership: { cfo: 0, cto: 0, coo: 0, headOfSales: 0 },
  };
}

export function makeMacro(overrides: Partial<MacroState> = {}): MacroState {
  return {
    quarterIndex: 0,
    policyRateBps: BALANCE.centralBank.startRateBps,
    oilIndex: 1,
    cycleIndex: 1,
    activeEffects: [],
    ...overrides,
  };
}

/** The three AI companies of a sector: bluechip, mid cap, penny stock. */
export function makeSectorCompanies(sectorId: SectorId): CompanyState[] {
  return [
    makeAiCompany(`${sectorId}-blue`, sectorId, 0.5, 64, 0.26, 0.175),
    makeAiCompany(`${sectorId}-mid`, sectorId, 0.32, 53, 0.2, 0.1),
    makeAiCompany(`${sectorId}-penny`, sectorId, 0.18, 41, 0.13, 0.05),
  ];
}
