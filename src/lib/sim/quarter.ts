/**
 * Quarter close (spec 4, 6): the company simulation for AI and player companies.
 *
 * Pipeline (see docs/SIMULATION.md):
 *   sector demand -> decisions -> awareness / quality / capacity -> attractiveness
 *   -> market shares with capacity caps -> revenue -> costs -> tax -> net income
 *   -> dividend -> cash -> insolvency counter -> fair value -> guidance check
 *   -> news, reputation and XP events -> macro state of the next quarter
 *
 * `closeQuarter` is pure. It returns everything as data (new state, reports,
 * news, events, tick shocks); booking payroll, interest, dividends and XP is the
 * job of the database functions (ADR-004, ADR-007).
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig, CompanyTierId, DepartmentId, SectorId } from "../../config/balance.ts";
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
  TickShock,
  XpEvent,
} from "./types.ts";

const DEPARTMENTS: readonly DepartmentId[] = ["development", "sales", "production", "finance", "marketing"];
const HISTORY_LENGTH = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Fixed costs per quarter of a tier in a sector (tier value x capital intensity). */
export function tierFixedCostCents(tier: CompanyTierId, sectorId: SectorId, cfg: BalanceConfig = BALANCE): bigint {
  const tierCfg = cfg.company.tiers.find((t) => t.id === tier);
  if (!tierCfg) throw new RangeError(`unknown tier: ${tier}`);
  return scaleByFloat(BigInt(tierCfg.fixedCostCentsPerQuarter), cfg.sectors[sectorId].costStructure.fixedCostMultiplier);
}

/**
 * Sector demand of one quarter in cents (as number):
 * base x trend growth x cycle^e x oil^e x rate factor x running macro effects x noise.
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

/** Quality after one quarter: decay, development work (less effective near the top), finished projects. */
export function nextQuality(
  quality: number,
  developmentSkillPoints: number,
  completedProjectGain: number,
  sectorId: SectorId,
  cfg: BalanceConfig = BALANCE,
): number {
  const q = cfg.company.quality;
  const saturation = developmentSkillPoints / (developmentSkillPoints + q.halfSaturationSkillPoints);
  const headroom = Math.max(0, 1 - quality / q.max);
  const gain = q.maxGainPerQuarter * saturation * headroom;
  const decay = cfg.sectors[sectorId].costStructure.qualityDecayPerQuarter;
  return clamp(quality - decay + gain + completedProjectGain, q.min, q.max);
}

/** Unit cost of a sector in cents at the current oil price. */
export function unitCostCents(sectorId: SectorId, oilIndex: number, cfg: BalanceConfig = BALANCE): number {
  const sector = cfg.sectors[sectorId];
  return sector.costStructure.unitCostCents * Math.pow(Math.max(0.01, oilIndex), sector.sensitivity.oilCost);
}

/** Allowed unit price range of a sector in cents (inclusive). */
export function priceBandCents(sectorId: SectorId, cfg: BalanceConfig = BALANCE): { readonly min: number; readonly max: number } {
  const cost = cfg.sectors[sectorId].costStructure;
  const min = Math.max(1, Math.ceil(cost.referencePriceCents * cfg.company.priceBand.minFactor));
  const max = Math.floor(
    cost.unitCostCents + (cost.referencePriceCents - cost.unitCostCents) * cfg.company.priceBand.maxMarginFactor,
  );
  return { min, max: Math.max(min, max) };
}

/**
 * Decision policy of an AI company for the coming quarter: price follows the
 * reference price plus cost pass-through (oil), marketing is a fixed share of
 * revenue, a fixed share of trailing profit is paid out.
 */
export function aiCompanyDecision(
  company: CompanyState,
  macro: MacroState,
  rng: Rng,
  cfg: BalanceConfig = BALANCE,
): QuarterDecision {
  const policy = cfg.company.aiPolicy;
  const cost = cfg.sectors[company.sectorId].costStructure;
  // Keep the absolute unit margin of the reference price when costs move.
  const reference = cost.referencePriceCents - cost.unitCostCents + unitCostCents(company.sectorId, macro.oilIndex, cfg);
  const current = Number(company.unitPriceCents);
  const reverted = current + policy.priceReversion * (reference - current);
  const unitPriceCents = roundToBigInt(Math.max(1, Math.round(reverted * Math.exp(rng.normal(0, policy.priceNoise)))));

  const lastRevenue = company.revenueHistoryCents[company.revenueHistoryCents.length - 1] ?? ZERO;
  const marketingBudgetCents = scaleByFloat(lastRevenue, policy.marketingShareOfRevenue);

  const trailing = sumBig(company.netIncomeHistoryCents.slice(-4));
  const dividendPerShareCents =
    trailing > ZERO && company.sharesOutstanding > ZERO
      ? scaleByFloat(trailing, policy.dividendPayoutRatio / 4) / company.sharesOutstanding
      : ZERO;
  return { companyId: company.id, unitPriceCents, marketingBudgetCents, dividendPerShareCents, guidanceRevenueCents: null };
}

/**
 * Staffing policy of an AI company after a quarter: all departments grow when
 * production ran above the target utilisation and shrink when it ran far below.
 * AI companies keep aggregated departments, so this simply scales skill points
 * and payroll.
 */
export function aiAdjustStaffing(company: CompanyState, utilization: number, cfg: BalanceConfig = BALANCE): CompanyState {
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

interface Prepared {
  readonly company: CompanyState;
  readonly decision: QuarterDecision | undefined;
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

    // Decisions, awareness, quality, capacity, attractiveness.
    const prepared: Prepared[] = active.map((company) => prepare(company, decisionById.get(company.id), cfg));

    // Market shares with capacity caps.
    const allocation = allocateDemand(
      demand,
      prepared.map((p) => ({
        attractiveness: p.attractiveness,
        capacityRevenue: p.capacityUnits * Number(p.unitPriceCents),
      })),
    );
    let totalAttractiveness = 0;
    for (const p of prepared) totalAttractiveness += p.attractiveness;

    sectors.push({
      sectorId,
      demandCents: roundToBigInt(Math.floor(demand)),
      unservedDemandCents: roundToBigInt(Math.floor(allocation.unservedDemand)),
    });

    prepared.forEach((p, i) => {
      const revenue = allocation.revenues[i] ?? 0;
      const share = allocation.shares[i] ?? 0;
      const attractivenessShare = totalAttractiveness > 0 ? p.attractiveness / totalAttractiveness : 0;
      const outcome = settleCompany(p, revenue, share, attractivenessShare, macro, cfg);
      reports.push(outcome.report);
      nextCompanies.set(p.company.id, outcome.company);
      news.push(...outcome.news);
      reputationEvents.push(...outcome.reputationEvents);
      xpEvents.push(...outcome.xpEvents);
      shocks.push(...outcome.shocks);
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

function prepare(company: CompanyState, decision: QuarterDecision | undefined, cfg: BalanceConfig): Prepared {
  const sectorCfg = cfg.sectors[company.sectorId];
  const cost = sectorCfg.costStructure;

  // Price inside the allowed band around the sector reference price.
  const requested = Number(decision?.unitPriceCents ?? company.unitPriceCents);
  const band = priceBandCents(company.sectorId, cfg);
  const unitPriceCents = roundToBigInt(clamp(Math.round(requested), band.min, band.max));

  // Marketing budget, limited by the available cash.
  const requestedBudget = decision?.marketingBudgetCents ?? ZERO;
  const affordable = company.cashCents > ZERO ? scaleByFloat(company.cashCents, cfg.company.maxMarketingBudgetShareOfCash) : ZERO;
  const positiveBudget = requestedBudget > ZERO ? requestedBudget : ZERO;
  const marketingCents = positiveBudget < affordable ? positiveBudget : affordable;
  const referenceBudget = sectorCfg.baseDemandCentsPerQuarter * cfg.company.marketing.referenceBudgetShareOfSectorDemand;
  const awareness = nextAwareness(company.awareness, Number(marketingCents), referenceBudget, cfg.company.marketing);

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
    (1 + Math.min(cfg.company.sales.maxBoost, company.departments.sales.effectiveSkillPoints * cfg.company.sales.boostPerSkillPoint)) *
    (1 + lead.headOfSalesBoostPerSkill * company.leadership.headOfSales);
  const value =
    attractiveness({ quality, awareness, price: Number(unitPriceCents) }, cfg.company.attractiveness) * salesBoost;

  return { company, decision, unitPriceCents, marketingCents, awareness, quality, projects, capacityUnits, attractiveness: value };
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
  const fixedCostCents = company.fixedCostCents;
  const overdraftCents = company.cashCents < ZERO ? -company.cashCents : ZERO;
  const interestCents =
    quarterlyInterestCents(company.debtCents, company.loanRateBps, cfg.time.quartersPerGameYear) +
    quarterlyInterestCents(
      overdraftCents,
      macro.policyRateBps + cfg.company.insolvency.overdraftSpreadBps,
      cfg.time.quartersPerGameYear,
    );

  const preTaxCents = revenueCents - productionCostCents - payrollCents - fixedCostCents - p.marketingCents - interestCents;
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

  // Insolvency counter: a quarter is uncovered if the cash ends below zero.
  const uncoveredQuarters = cashAfterCents < ZERO ? company.uncoveredQuarters + 1 : 0;
  const becameInsolvent = uncoveredQuarters >= cfg.company.insolvency.uncoveredQuartersToInsolvency;

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
      const band = Math.max(
        0.02,
        cfg.reputation.guidanceHitThreshold * (1 + cfg.employees.leadership.cfoGuidanceBandReductionPerSkill * company.leadership.cfo),
      );
      if (Math.abs(guidanceDeviation) <= band) {
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
    becameInsolvent,
  };

  return { company: nextCompany, report, news, reputationEvents, xpEvents, shocks };
}
