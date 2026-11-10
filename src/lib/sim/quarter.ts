/**
 * Quarter close (spec 4, 6): the company simulation for AI and player companies.
 *
 * Pipeline (see docs/SIMULATION.md):
 *   sector demand -> market segments -> decisions -> awareness / quality / capacity
 *   -> attractiveness -> market shares inside the segment with capacity caps
 *   -> revenue -> costs -> tax -> net income -> dividend -> cash -> grace period
 *   and insolvency -> fair value -> guidance check -> news, reputation and XP
 *   events -> macro state of the next quarter
 *
 * `closeQuarter` is pure. It returns everything as data (new state, reports,
 * news, events, tick shocks); booking payroll, interest, dividends and XP is the
 * job of the database functions (ADR-004, ADR-007).
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig, CompanyTierId, DepartmentId, SectorId, SegmentId } from "../../config/balance.ts";
import {
  SECTOR_IDS,
  ageEffects,
  earningsSentiment,
  effectDemandFactor,
  rollMacroEvents,
  stepCycleIndex,
  stepOilIndex,
} from "./events.ts";
import { fairValueE4, trailingRevenueGrowth } from "./fair-value.ts";
import { quarterlyInterestCents } from "./loans.ts";
import { allocateDemand, attractiveness, nextAwareness } from "./market-share.ts";
import { ZERO, applyBps, roundToBigInt, scaleByFloat, sumBig } from "./money.ts";
import type {
  CompanyQuarterReport,
  CompanyState,
  MacroState,
  NewsItem,
  ProductProject,
  QuarterDecision,
  QuarterResult,
  QuarterState,
  ReputationEvent,
  Rng,
  SectorQuarterResult,
  SegmentQuarterResult,
  TickShock,
  XpEvent,
} from "./types.ts";

const DEPARTMENTS: readonly DepartmentId[] = ["development", "sales", "production", "finance", "marketing"];
export const SEGMENT_IDS: readonly SegmentId[] = ["local", "regional", "national", "international"];
const HISTORY_LENGTH = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Saturating effect of a department: 0 without staff, 0.5 at `half` skill points, towards 1. */
function saturation(skillPoints: number, half: number): number {
  const points = Math.max(0, skillPoints);
  return points / (points + half);
}

// ------------------------------------------------------------------ segments

/** The market segment a company tier sells in (one segment per tier). */
export function segmentForTier(tier: CompanyTierId, cfg: BalanceConfig = BALANCE): SegmentId {
  for (const id of SEGMENT_IDS) if (cfg.company.segments[id].tier === tier) return id;
  throw new RangeError(`no segment for tier: ${tier}`);
}

/** Baseline demand of a segment in cents (sector base demand x segment share). */
export function segmentBaseDemand(sectorId: SectorId, segmentId: SegmentId, cfg: BalanceConfig = BALANCE): number {
  return cfg.sectors[sectorId].baseDemandCentsPerQuarter * cfg.company.segments[segmentId].demandShare;
}

/**
 * Awareness after a tier change. Awareness is the share of the segment's
 * customers who know the company; the number of customers who know it stays
 * the same, the market around it gets bigger (or smaller).
 */
export function awarenessAfterTierChange(
  awareness: number,
  fromTier: CompanyTierId,
  toTier: CompanyTierId,
  cfg: BalanceConfig = BALANCE,
): number {
  const from = cfg.company.segments[segmentForTier(fromTier, cfg)].demandShare;
  const to = cfg.company.segments[segmentForTier(toTier, cfg)].demandShare;
  return clamp((awareness * from) / to, cfg.company.marketing.minAwareness, 1);
}

// --------------------------------------------------------------- cost and price

/** Fixed costs per quarter of a tier in a sector (tier value x capital intensity). */
export function tierFixedCostCents(tier: CompanyTierId, sectorId: SectorId, cfg: BalanceConfig = BALANCE): bigint {
  const tierCfg = cfg.company.tiers.find((t) => t.id === tier);
  if (!tierCfg) throw new RangeError(`unknown tier: ${tier}`);
  return scaleByFloat(
    BigInt(tierCfg.fixedCostCentsPerQuarter),
    cfg.sectors[sectorId].costStructure.fixedCostMultiplier,
  );
}

/** Unit cost of a sector in cents at the current oil price. */
export function unitCostCents(sectorId: SectorId, oilIndex: number, cfg: BalanceConfig = BALANCE): number {
  const sector = cfg.sectors[sectorId];
  return sector.costStructure.unitCostCents * Math.pow(Math.max(0.01, oilIndex), sector.sensitivity.oilCost);
}

/**
 * Price of the established suppliers: the reference price plus full pass-through
 * of cost changes (oil). AI companies steer towards it, the anonymous incumbents
 * of the small segments sell exactly at it.
 */
export function marketPriceCents(sectorId: SectorId, oilIndex: number, cfg: BalanceConfig = BALANCE): number {
  const cost = cfg.sectors[sectorId].costStructure;
  return cost.referencePriceCents - cost.unitCostCents + unitCostCents(sectorId, oilIndex, cfg);
}

/** Range of the price slider in cents (inclusive). Sanity bounds only. */
export function priceBandCents(
  sectorId: SectorId,
  cfg: BalanceConfig = BALANCE,
): { readonly min: number; readonly max: number } {
  const reference = cfg.sectors[sectorId].costStructure.referencePriceCents;
  const min = Math.max(1, Math.ceil(reference * cfg.company.priceBand.minFactor));
  const max = Math.floor(reference * cfg.company.priceBand.maxFactor);
  return { min, max: Math.max(min, max) };
}

/** Attractiveness exponents of a sector (spec formula, sector-specific price exponent). */
export function sectorAttractivenessConfig(
  sectorId: SectorId,
  cfg: BalanceConfig = BALANCE,
): BalanceConfig["company"]["attractiveness"] {
  return { ...cfg.company.attractiveness, priceExponent: cfg.sectors[sectorId].priceExponent };
}

/** Attractiveness of the anonymous established suppliers of a segment (0 if there are none). */
export function incumbentAttractiveness(
  sectorId: SectorId,
  segmentId: SegmentId,
  oilIndex: number,
  cfg: BalanceConfig = BALANCE,
): number {
  const segment = cfg.company.segments[segmentId];
  if (segment.incumbentAwareness <= 0 || segment.incumbentQuality <= 0) return 0;
  return attractiveness(
    {
      quality: segment.incumbentQuality,
      awareness: segment.incumbentAwareness,
      price: marketPriceCents(sectorId, oilIndex, cfg),
    },
    sectorAttractivenessConfig(sectorId, cfg),
  );
}

/** Fixed costs after the saving of the finance department. */
export function effectiveFixedCostCents(
  fixedCostCents: bigint,
  financeSkillPoints: number,
  cfg: BalanceConfig = BALANCE,
): bigint {
  const f = cfg.company.finance;
  const reduction = f.maxFixedCostReduction * saturation(financeSkillPoints, f.halfSaturationSkillPoints);
  return scaleByFloat(fixedCostCents, 1 - reduction);
}

/** Marketing budget as it counts for awareness: the marketing department makes every euro work harder. */
export function effectiveMarketingBudget(
  budget: number,
  marketingSkillPoints: number,
  cfg: BalanceConfig = BALANCE,
): number {
  const m = cfg.company.marketing;
  return budget * (1 + m.departmentMaxBoost * saturation(marketingSkillPoints, m.departmentHalfSaturationSkillPoints));
}

// ------------------------------------------------------------------ demand

/**
 * Demand of a sector's international segment for one quarter in cents (as number):
 * base x trend growth x cycle^e x oil^e x rate factor x running macro effects x noise.
 * The smaller segments are this value times their `demandShare`.
 */
export function sectorDemand(
  sectorId: SectorId,
  macro: MacroState,
  noiseFactor = 1,
  cfg: BalanceConfig = BALANCE,
): number {
  const sector = cfg.sectors[sectorId];
  const years = macro.quarterIndex / cfg.time.quartersPerGameYear;
  const growth = Math.pow(1 + sector.demandGrowthBpsPerGameYear / 10_000, years);
  const cycle = Math.pow(Math.max(0.01, macro.cycleIndex), sector.sensitivity.cycle);
  const oil = Math.pow(Math.max(0.01, macro.oilIndex), sector.sensitivity.oilDemand);
  const rate = Math.max(
    0.5,
    1 + sector.sensitivity.ratePer100Bps * ((macro.policyRateBps - cfg.centralBank.neutralRateBps) / 100),
  );
  const effects = effectDemandFactor(macro.activeEffects, sectorId);
  return sector.baseDemandCentsPerQuarter * growth * cycle * oil * rate * effects * Math.max(0, noiseFactor);
}

/**
 * Demand of one market segment in cents (as number): the sector demand times
 * the segment share. Segments that do not grow with the sector (local,
 * regional, national) leave out the trend growth but feel cycle, oil, rates,
 * macro events and noise exactly like the big market.
 */
export function segmentDemand(
  sectorId: SectorId,
  segmentId: SegmentId,
  macro: MacroState,
  noiseFactor = 1,
  cfg: BalanceConfig = BALANCE,
): number {
  const segment = cfg.company.segments[segmentId];
  const reference = segment.growsWithSector ? macro : { ...macro, quarterIndex: 0 };
  return sectorDemand(sectorId, reference, noiseFactor, cfg) * segment.demandShare;
}

// ----------------------------------------------------------------- quality

/**
 * Quality the current development team can sustain. Depends on the developers
 * relative to the size of the company (production) and the sector's need for
 * development, so a large company does not get top quality for free.
 */
export function qualityTarget(
  developmentSkillPoints: number,
  productionSkillPoints: number,
  sectorId: SectorId,
  cfg: BalanceConfig = BALANCE,
): number {
  const q = cfg.company.quality;
  const need =
    cfg.sectors[sectorId].costStructure.developmentIntensity *
    (q.halfSaturationSkillPoints + q.productionScale * Math.max(0, productionSkillPoints));
  const x = Math.max(0, developmentSkillPoints) / need;
  return q.max * Math.pow(x / (1 + x), q.targetExponent);
}

/**
 * Quality after one quarter: moves a sector-specific share of the way to the
 * target (tech ages fast, retail slowly), finished product projects add a jump.
 */
export function nextQuality(
  quality: number,
  developmentSkillPoints: number,
  productionSkillPoints: number,
  completedProjectGain: number,
  sectorId: SectorId,
  cfg: BalanceConfig = BALANCE,
): number {
  const q = cfg.company.quality;
  const target = qualityTarget(developmentSkillPoints, productionSkillPoints, sectorId, cfg);
  const rate = cfg.sectors[sectorId].costStructure.qualityAdjustmentRate;
  return clamp(quality + rate * (target - quality) + completedProjectGain, q.min, q.max);
}

// ------------------------------------------------------------- AI companies

/**
 * Decision policy of an AI company for the coming quarter: price follows the
 * market price (reference plus cost pass-through), marketing is a fixed share
 * of revenue, a fixed share of trailing profit is paid out.
 */
export function aiCompanyDecision(
  company: CompanyState,
  macro: MacroState,
  rng: Rng,
  cfg: BalanceConfig = BALANCE,
): QuarterDecision {
  const policy = cfg.company.aiPolicy;
  const target = marketPriceCents(company.sectorId, macro.oilIndex, cfg);
  const current = Number(company.unitPriceCents);
  const reverted = current + policy.priceReversion * (target - current);
  const unitPriceCents = roundToBigInt(Math.max(1, Math.round(reverted * Math.exp(rng.normal(0, policy.priceNoise)))));

  const lastRevenue = company.revenueHistoryCents[company.revenueHistoryCents.length - 1] ?? ZERO;
  const marketingBudgetCents = scaleByFloat(lastRevenue, policy.marketingShareOfRevenue);

  const trailing = sumBig(company.netIncomeHistoryCents.slice(-4));
  const dividendPerShareCents =
    trailing > ZERO && company.sharesOutstanding > ZERO
      ? scaleByFloat(trailing, policy.dividendPayoutRatio / 4) / company.sharesOutstanding
      : ZERO;
  return {
    companyId: company.id,
    unitPriceCents,
    marketingBudgetCents,
    dividendPerShareCents,
    guidanceRevenueCents: null,
  };
}

/**
 * Staffing policy of an AI company after a quarter: all departments grow when
 * production ran above the target utilisation and shrink when it ran far below.
 * AI companies keep aggregated departments, so this simply scales skill points
 * and payroll.
 */
export function aiAdjustStaffing(
  company: CompanyState,
  utilization: number,
  cfg: BalanceConfig = BALANCE,
): CompanyState {
  const policy = cfg.company.aiPolicy;
  let factor = 1;
  if (utilization > policy.targetUtilization + policy.utilizationBand) factor = 1 + policy.hiringRatePerQuarter;
  else if (utilization < policy.targetUtilization - policy.utilizationBand) factor = 1 - policy.firingRatePerQuarter;
  if (factor === 1) return company;
  const departments = {} as Record<DepartmentId, CompanyState["departments"][DepartmentId]>;
  for (const d of DEPARTMENTS) {
    const current = company.departments[d];
    departments[d] = {
      effectiveSkillPoints: current.effectiveSkillPoints * factor,
      payrollCents: scaleByFloat(current.payrollCents, factor),
    };
  }
  return { ...company, departments };
}

// ------------------------------------------------------------ quarter close

interface Prepared {
  readonly company: CompanyState;
  readonly decision: QuarterDecision | undefined;
  readonly segmentId: SegmentId;
  readonly unitPriceCents: bigint;
  readonly marketingCents: bigint;
  readonly awareness: number;
  readonly quality: number;
  readonly projects: readonly ProductProject[];
  readonly capacityUnits: number;
  readonly attractiveness: number;
}

/** Closes one quarter for all companies. Deterministic for a given `rng` seed. */
export function closeQuarter(
  state: QuarterState,
  decisions: readonly QuarterDecision[],
  rng: Rng,
  cfg: BalanceConfig = BALANCE,
): QuarterResult {
  const macro = state.macro;
  const quarterIndex = macro.quarterIndex;
  const decisionById = new Map<string, QuarterDecision>();
  for (const d of decisions) decisionById.set(d.companyId, d);

  const sectors: SectorQuarterResult[] = [];
  const reports: CompanyQuarterReport[] = [];
  const news: NewsItem[] = [];
  const reputationEvents: ReputationEvent[] = [];
  const xpEvents: XpEvent[] = [];
  const shocks: TickShock[] = [];
  const nextCompanies = new Map<string, CompanyState>();

  for (const sectorId of SECTOR_IDS) {
    const sectorCfg = cfg.sectors[sectorId];
    const noise = 1 + rng.derive("sector", quarterIndex, sectorId).normal(0, sectorCfg.demandNoise);
    const demand = sectorDemand(sectorId, macro, noise, cfg);
    const active = state.companies.filter((c) => c.sectorId === sectorId && c.status === "active");
    const segmentResults: SegmentQuarterResult[] = [];

    for (const segmentId of SEGMENT_IDS) {
      const demandOfSegment = segmentDemand(sectorId, segmentId, macro, noise, cfg);
      const prepared: Prepared[] = active
        .filter((c) => segmentForTier(c.tier, cfg) === segmentId)
        .map((company) => prepare(company, decisionById.get(company.id), segmentId, cfg));

      // Spec 6.2 inside the segment. The established suppliers are one more
      // competitor with unlimited capacity; what they sell is not player revenue.
      const incumbent = incumbentAttractiveness(sectorId, segmentId, macro.oilIndex, cfg);
      const claims = prepared.map((p) => ({
        attractiveness: p.attractiveness,
        capacityRevenue: p.capacityUnits * Number(p.unitPriceCents),
      }));
      if (incumbent > 0) claims.push({ attractiveness: incumbent, capacityRevenue: Infinity });
      const allocation = allocateDemand(demandOfSegment, claims);
      let totalAttractiveness = incumbent;
      for (const p of prepared) totalAttractiveness += p.attractiveness;

      const segmentDemandCents = roundToBigInt(Math.floor(demandOfSegment));
      segmentResults.push({
        segmentId,
        demandCents: segmentDemandCents,
        incumbentRevenueCents:
          incumbent > 0 ? roundToBigInt(Math.floor(allocation.revenues[prepared.length] ?? 0)) : ZERO,
        unservedDemandCents: roundToBigInt(Math.floor(allocation.unservedDemand)),
      });

      prepared.forEach((p, i) => {
        const revenue = allocation.revenues[i] ?? 0;
        const share = allocation.shares[i] ?? 0;
        const attractivenessShare = totalAttractiveness > 0 ? p.attractiveness / totalAttractiveness : 0;
        const outcome = settleCompany(p, revenue, share, attractivenessShare, segmentDemandCents, macro, cfg);
        reports.push(outcome.report);
        nextCompanies.set(p.company.id, outcome.company);
        news.push(...outcome.news);
        reputationEvents.push(...outcome.reputationEvents);
        xpEvents.push(...outcome.xpEvents);
        shocks.push(...outcome.shocks);
      });
    }

    const international = segmentResults.find((s) => s.segmentId === "international");
    sectors.push({
      sectorId,
      demandCents: roundToBigInt(Math.floor(demand)),
      unservedDemandCents: international ? international.unservedDemandCents : ZERO,
      segments: segmentResults,
    });
  }

  // Macro state of the next quarter. Events rolled now are announced now and hit
  // demand from the next quarter on: public information leads the fundamentals.
  const macroRng = rng.derive("macro", quarterIndex);
  const roll = rollMacroEvents(macroRng, cfg.events.macro);
  let oilIndex = macro.oilIndex;
  const oilReportDue = (quarterIndex + 1) % cfg.events.oilReport.everyQuarters === 0;
  if (oilReportDue) oilIndex = stepOilIndex(oilIndex, macroRng, cfg.events.oilReport);
  oilIndex = clamp(oilIndex * roll.oilFactor, cfg.events.oilReport.minIndex, cfg.events.oilReport.maxIndex);
  const oilChange = oilIndex / macro.oilIndex - 1;
  const macroNews: NewsItem[] = [...roll.news];
  if (oilReportDue && roll.oilFactor === 1) {
    macroNews.push({
      templateKey: oilChange >= 0 ? "macro.oil_report_up" : "macro.oil_report_down",
      scope: "sector",
      sectorId: "energy",
      vars: { oilChangePct: oilChange * 100, oilIndex },
      sentimentDelta: clamp(oilChange * 3, -0.5, 0.5),
      importance: 2,
    });
  }

  const listedActive = [...nextCompanies.values()].filter((c) => c.listed && c.status === "active");
  for (const item of macroNews) {
    news.push(item);
    for (const company of listedActive) {
      let delta = 0;
      if (item.scope === "market") delta = item.sentimentDelta;
      else if (item.sectorId === company.sectorId) delta = item.sentimentDelta;
      // Oil news cut both ways (spec 10.1): good for energy, bad for logistics.
      else if (item.templateKey.startsWith("macro.oil") || item.templateKey.startsWith("macro.commodity")) {
        if (company.sectorId === "logistics") delta = -item.sentimentDelta * cfg.sectors.logistics.sensitivity.oilCost;
      }
      if (delta !== 0) shocks.push({ securityId: company.id, sentimentDelta: delta });
    }
  }

  const nextMacro: MacroState = {
    quarterIndex: quarterIndex + 1,
    policyRateBps: macro.policyRateBps,
    oilIndex,
    cycleIndex: stepCycleIndex(macro.cycleIndex, macroRng, cfg.events.businessCycle),
    activeEffects: [...ageEffects(macro.activeEffects), ...roll.effects],
  };

  return {
    state: {
      macro: nextMacro,
      companies: state.companies.map((c) => nextCompanies.get(c.id) ?? c),
    },
    sectors,
    reports,
    news,
    reputationEvents,
    xpEvents,
    shocks,
  };
}

function prepare(
  company: CompanyState,
  decision: QuarterDecision | undefined,
  segmentId: SegmentId,
  cfg: BalanceConfig,
): Prepared {
  const cost = cfg.sectors[company.sectorId].costStructure;

  // Price inside the slider range.
  const requested = Number(decision?.unitPriceCents ?? company.unitPriceCents);
  const band = priceBandCents(company.sectorId, cfg);
  const unitPriceCents = roundToBigInt(clamp(Math.round(requested), band.min, band.max));

  // Marketing budget, limited by the available cash; the marketing department multiplies its effect.
  const requestedBudget = decision?.marketingBudgetCents ?? ZERO;
  const affordable =
    company.cashCents > ZERO ? scaleByFloat(company.cashCents, cfg.company.maxMarketingBudgetShareOfCash) : ZERO;
  const positiveBudget = requestedBudget > ZERO ? requestedBudget : ZERO;
  const marketingCents = positiveBudget < affordable ? positiveBudget : affordable;
  const referenceBudget =
    segmentBaseDemand(company.sectorId, segmentId, cfg) * cfg.company.marketing.referenceBudgetShareOfSegmentDemand;
  const awareness = nextAwareness(
    company.awareness,
    effectiveMarketingBudget(Number(marketingCents), company.departments.marketing.effectiveSkillPoints, cfg),
    referenceBudget,
    cfg.company.marketing,
  );

  // Product projects (time gate) and continuous development.
  let completedGain = 0;
  const projects: ProductProject[] = [];
  for (const project of company.projects) {
    const remaining = project.quartersRemaining - 1;
    if (remaining <= 0) completedGain += project.qualityGain;
    else projects.push({ ...project, quartersRemaining: remaining });
  }
  const quality = nextQuality(
    company.quality,
    company.departments.development.effectiveSkillPoints,
    company.departments.production.effectiveSkillPoints,
    completedGain,
    company.sectorId,
    cfg,
  );

  const lead = cfg.employees.leadership;
  const capacityUnits =
    company.departments.production.effectiveSkillPoints *
    cost.capacityUnitsPerSkillPoint *
    (1 + lead.cooCapacityBonusPerSkill * company.leadership.coo);
  const salesBoost =
    (1 +
      Math.min(
        cfg.company.sales.maxBoost,
        company.departments.sales.effectiveSkillPoints * cfg.company.sales.boostPerSkillPoint,
      )) *
    (1 + lead.headOfSalesBoostPerSkill * company.leadership.headOfSales);
  const value =
    attractiveness(
      { quality, awareness, price: Number(unitPriceCents) },
      sectorAttractivenessConfig(company.sectorId, cfg),
    ) * salesBoost;

  return {
    company,
    decision,
    segmentId,
    unitPriceCents,
    marketingCents,
    awareness,
    quality,
    projects,
    capacityUnits,
    attractiveness: value,
  };
}

interface Outcome {
  readonly company: CompanyState;
  readonly report: CompanyQuarterReport;
  readonly news: NewsItem[];
  readonly reputationEvents: ReputationEvent[];
  readonly xpEvents: XpEvent[];
  readonly shocks: TickShock[];
}

function settleCompany(
  p: Prepared,
  revenue: number,
  marketShare: number,
  attractivenessShare: number,
  segmentDemandCents: bigint,
  macro: MacroState,
  cfg: BalanceConfig,
): Outcome {
  const { company, decision } = p;
  const sectorCfg = cfg.sectors[company.sectorId];
  const news: NewsItem[] = [];
  const reputationEvents: ReputationEvent[] = [];
  const xpEvents: XpEvent[] = [];
  const shocks: TickShock[] = [];

  // Revenue and costs.
  const revenueCents = roundToBigInt(Math.floor(revenue));
  const unitsSold = revenue / Number(p.unitPriceCents);
  const unitCost = unitCostCents(company.sectorId, macro.oilIndex, cfg);
  const productionCostCents = roundToBigInt(Math.round(unitsSold * unitCost));
  const payrollCents = sumBig(DEPARTMENTS.map((d) => company.departments[d].payrollCents));
  const fixedCostCents = effectiveFixedCostCents(
    company.fixedCostCents,
    company.departments.finance.effectiveSkillPoints,
    cfg,
  );
  const overdraftCents = company.cashCents < ZERO ? -company.cashCents : ZERO;
  const interestCents =
    quarterlyInterestCents(company.debtCents, company.loanRateBps, cfg.time.quartersPerGameYear) +
    quarterlyInterestCents(
      overdraftCents,
      macro.policyRateBps + cfg.company.insolvency.overdraftSpreadBps,
      cfg.time.quartersPerGameYear,
    );

  const preTaxCents =
    revenueCents - productionCostCents - payrollCents - fixedCostCents - p.marketingCents - interestCents;
  const taxCents = preTaxCents > ZERO ? applyBps(preTaxCents, cfg.company.corporateTaxBps) : ZERO;
  const netIncomeCents = preTaxCents - taxCents;
  const cashBeforeDividend = company.cashCents + netIncomeCents;

  // Dividend: only paid if the cash covers it completely.
  const requestedDps = decision?.dividendPerShareCents ?? ZERO;
  const requestedTotal = requestedDps > ZERO ? requestedDps * company.sharesOutstanding : ZERO;
  const dividendPaid = requestedTotal > ZERO && cashBeforeDividend >= requestedTotal;
  const dividendPerShareCents = dividendPaid ? requestedDps : ZERO;
  const dividendTotalCents = dividendPaid ? requestedTotal : ZERO;
  const cashAfterCents = cashBeforeDividend - dividendTotalCents;
  const bookEquityCents = company.bookEquityCents + netIncomeCents - dividendTotalCents;

  // Grace period: the first close with negative cash starts the clock. The
  // company is insolvent if the cash is still negative `graceQuarters` closes later.
  const grace = cfg.company.insolvency.graceQuarters;
  const uncoveredQuarters = cashAfterCents < ZERO ? company.uncoveredQuarters + 1 : 0;
  const becameInsolvent = uncoveredQuarters > grace;
  const graceQuartersLeft = uncoveredQuarters === 0 ? null : Math.max(0, grace + 1 - uncoveredQuarters);

  // History and per-share figures.
  const previousNet = company.netIncomeHistoryCents.slice(-4);
  const revenueHistoryCents = [...company.revenueHistoryCents, revenueCents].slice(-HISTORY_LENGTH);
  const netIncomeHistoryCents = [...company.netIncomeHistoryCents, netIncomeCents].slice(-HISTORY_LENGTH);
  const recentNet = netIncomeHistoryCents.slice(-4);
  const shares = Number(company.sharesOutstanding);
  const annualizedNet = (Number(sumBig(recentNet)) * 4) / recentNet.length;
  const epsTtmCents = shares > 0 ? annualizedNet / shares : 0;

  const fairValue =
    company.listed && shares > 0
      ? fairValueE4(
          {
            epsTtmCents,
            sector: sectorCfg,
            revenueGrowth: trailingRevenueGrowth(revenueHistoryCents),
            founderReputation: company.founderReputation,
            policyRateBps: macro.policyRateBps,
            bookValuePerShareCents: Number(bookEquityCents) / shares,
            eventValueFactor: company.eventValueFactor,
          },
          {
            valuation: cfg.valuation,
            reputation: cfg.reputation,
            centralBank: cfg.centralBank,
            minPriceE4: cfg.trading.minPriceE4,
          },
        )
      : null;

  // Guidance (player companies): deviation in either direction counts.
  let guidanceDeviation: number | null = null;
  if (company.guidanceRevenueCents !== null && company.guidanceRevenueCents > ZERO) {
    guidanceDeviation = Number(revenueCents) / Number(company.guidanceRevenueCents) - 1;
    if (company.founderId !== null) {
      if (Math.abs(guidanceDeviation) <= cfg.reputation.guidanceHitThreshold) {
        reputationEvents.push({
          playerId: company.founderId,
          companyId: company.id,
          kind: "guidance_met",
          delta: cfg.reputation.deltas.guidanceMet,
        });
      } else if (Math.abs(guidanceDeviation) > cfg.reputation.guidanceMissThreshold) {
        reputationEvents.push({
          playerId: company.founderId,
          companyId: company.id,
          kind: "guidance_missed",
          delta: cfg.reputation.deltas.guidanceMissed,
        });
      }
    }
  }

  if (company.founderId !== null) {
    if (netIncomeCents > ZERO) {
      // Base XP; the alpha multiplier is applied when the XP are granted (`scaledXp`).
      xpEvents.push({
        playerId: company.founderId,
        kind: "profitable_company_quarter",
        xp: cfg.progression.xpSources.profitableCompanyQuarter.xp,
        companyId: company.id,
      });
    }
    if (company.listed && dividendPaid) {
      reputationEvents.push({
        playerId: company.founderId,
        companyId: company.id,
        kind: "reliable_dividend",
        delta: cfg.reputation.deltas.reliableDividend,
      });
    } else if (company.listed && requestedTotal > ZERO && !dividendPaid) {
      reputationEvents.push({
        playerId: company.founderId,
        companyId: company.id,
        kind: "dividend_cut",
        delta: cfg.reputation.deltas.dividendCut,
      });
    }
  }

  // Earnings news and sentiment shock for listed companies.
  if (company.listed && !becameInsolvent) {
    let sentimentDelta = 0;
    let surprise = 0;
    if (previousNet.length > 0) {
      const expected = sumBig(previousNet) / BigInt(previousNet.length);
      const s = earningsSentiment(netIncomeCents, expected, revenueCents, cfg.events.earnings);
      sentimentDelta = s.sentimentDelta;
      surprise = s.surprise;
    }
    const templateKey = surprise > 0.1 ? "earnings.beat" : surprise < -0.1 ? "earnings.miss" : "earnings.inline";
    news.push({
      templateKey,
      scope: "company",
      companyId: company.id,
      sectorId: company.sectorId,
      vars: {
        quarterIndex: macro.quarterIndex,
        revenueCents: revenueCents.toString(),
        netIncomeCents: netIncomeCents.toString(),
        marketSharePct: marketShare * 100,
        surprisePct: surprise * 100,
      },
      sentimentDelta,
      importance: Math.abs(surprise) > 0.3 ? 3 : 2,
    });
    if (sentimentDelta !== 0) shocks.push({ securityId: company.id, sentimentDelta });
  }

  if (becameInsolvent) {
    news.push({
      templateKey: "company.insolvency",
      scope: "company",
      companyId: company.id,
      sectorId: company.sectorId,
      vars: { quarterIndex: macro.quarterIndex, cashCents: cashAfterCents.toString() },
      sentimentDelta: -1,
      importance: 3,
    });
    if (company.listed) {
      shocks.push({ securityId: company.id, sentimentDelta: -1, priceReturn: cfg.company.insolvency.priceCrashReturn });
    }
    if (company.founderId !== null) {
      reputationEvents.push({
        playerId: company.founderId,
        companyId: company.id,
        kind: "insolvency",
        delta: cfg.reputation.deltas.insolvency,
      });
    }
  }

  const nextCompany: CompanyState = {
    ...company,
    status: becameInsolvent ? "insolvent" : "active",
    cashCents: cashAfterCents,
    bookEquityCents,
    quality: p.quality,
    awareness: p.awareness,
    unitPriceCents: p.unitPriceCents,
    projects: p.projects,
    guidanceRevenueCents: decision?.guidanceRevenueCents ?? null,
    uncoveredQuarters,
    quartersActive: company.quartersActive + 1,
    revenueHistoryCents,
    netIncomeHistoryCents,
  };

  const report: CompanyQuarterReport = {
    companyId: company.id,
    quarterIndex: macro.quarterIndex,
    segmentId: p.segmentId,
    segmentDemandCents,
    marketShare,
    attractivenessShare,
    unitsSold,
    capacityUnits: p.capacityUnits,
    revenueCents,
    productionCostCents,
    payrollCents,
    fixedCostCents,
    marketingCents: p.marketingCents,
    interestCents,
    taxCents,
    netIncomeCents,
    dividendPerShareCents,
    dividendTotalCents,
    cashAfterCents,
    epsTtmCents,
    guidanceDeviation,
    fairValueE4: fairValue,
    uncoveredQuarters,
    graceQuartersLeft,
    becameInsolvent,
  };

  return { company: nextCompany, report, news, reputationEvents, xpEvents, shocks };
}
