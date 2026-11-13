/**
 * Player companies (ADR-057, docs/PLAYER_COMPANIES.md): garage startup and small
 * business. One call = one game quarter. The database runs the same formulas in
 * PL/pgSQL; the demo and the UI use these.
 *
 * Demand grows like an S-curve towards the hidden market size of the niche; the
 * team's productivity (founder, players, AI workers) limits what can be sold, the
 * team's skills in the sector set the quality.
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig, SectorId, StartupsConfig } from "../../config/balance.ts";
import { roundToBigInt } from "./money.ts";

export type StartupTier = "garage" | "small_business" | "gmbh" | "ag";
export type PriceLevel = "budget" | "normal" | "premium";

export interface StartupState {
  /** Hidden: yearly revenue the niche can carry at full awareness and quality. */
  readonly potentialAnnualCents: number;
  /** Share of possible customers who know the company, 0..1. */
  readonly awareness: number;
  /** 0..1 */
  readonly quality: number;
  readonly quartersActive: number;
  readonly cashCents: bigint;
}

export interface StartupQuarterInput {
  readonly sector: SectorId;
  readonly tier: StartupTier;
  readonly marketingCents: bigint;
  /** Productivity of every worker in bps (founder and players ≥ 15 000, AI workers 10 000). */
  readonly productivityBps: readonly number[];
  readonly aiWorkers: number;
  /** Sum of the team's branch scores in the sector's branches (quality). */
  readonly teamSectorScore: number;
  /** Growth stage reached by the team's skills (ADR-062), 0..4. */
  readonly stage: number;
  /** Standard normal draw for the demand noise (passed in: the sim never draws itself). */
  readonly noise: number;
  /** Price strategy (ADR-083), default normal. */
  readonly priceLevel?: PriceLevel;
  /** Expansion level (ADR-083), default 0. */
  readonly expansionLevel?: number;
}

export interface StartupQuarterResult {
  readonly demandCents: bigint;
  readonly capacityCents: bigint;
  readonly revenueCents: bigint;
  readonly cogsCents: bigint;
  readonly fixedCents: bigint;
  readonly aiWorkerCents: bigint;
  readonly marketingCents: bigint;
  /** Revenue minus goods, fixed costs, AI workers and marketing (player wages are paid continuously). */
  readonly operatingProfitCents: bigint;
  readonly utilization: number;
  readonly next: StartupState;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Draw the hidden market size from a uniform number u in (0, 1]: Pareto with the configured alpha. */
export function potentialFromUniform(u: number, cfg: StartupsConfig = BALANCE.startups): number {
  const { minAnnualCents, maxAnnualCents, paretoAlpha } = cfg.potential;
  const safe = clamp(u, 1e-12, 1);
  return Math.min(maxAnnualCents, Math.round(minAnnualCents * Math.pow(safe, -1 / paretoAlpha)));
}

export function initialStartup(
  potentialAnnualCents: number,
  cashCents: bigint,
  cfg = BALANCE.startups,
  tier: Exclude<StartupTier, "ag"> = "garage",
): StartupState {
  return {
    potentialAnnualCents,
    awareness: tier === "garage" ? cfg.awareness.initial : cfg.foundingAwareness[tier],
    quality: cfg.quality.base,
    quartersActive: 0,
    cashCents,
  };
}

/** Quality the team can reach: base plus the rest, saturating with the team's sector skills. */
export function qualityTarget(teamSectorScore: number, cfg: StartupsConfig = BALANCE.startups): number {
  const score = Math.max(0, teamSectorScore);
  return cfg.quality.base + (1 - cfg.quality.base) * (score / (score + cfg.quality.halfSaturationScore));
}

/** Awareness gained from a marketing budget (diminishing returns). */
export function marketingGain(
  marketingCents: number,
  potentialAnnualCents: number,
  cfg: StartupsConfig = BALANCE.startups,
): number {
  if (marketingCents <= 0) return 0;
  const a = cfg.awareness;
  const half = Math.max(a.marketingMinHalfSaturationCents, (potentialAnnualCents / 4) * a.marketingHalfSaturationShare);
  return (a.marketingMaxGain * marketingCents) / (marketingCents + half);
}

/** Revenue the team can serve per quarter (before stage and expansion bonuses). */
export function capacityCents(
  productivityBps: readonly number[],
  sector: SectorId,
  cfg: StartupsConfig = BALANCE.startups,
): number {
  const units = productivityBps.reduce((sum, p) => sum + p / 10_000, 0);
  return units * cfg.capacityCentsPerProductivity[sector];
}

const level = (expansionLevel: number | undefined) => Math.max(0, Math.floor(expansionLevel ?? 0));

/** Fixed costs per quarter; every expansion level adds a share of the base (ADR-083). */
export function fixedCostCents(tier: StartupTier, cfg: BalanceConfig = BALANCE, expansionLevel = 0): number {
  const base =
    tier === "garage"
      ? cfg.startups.garage.fixedCostCentsPerQuarter
      : tier === "gmbh"
        ? cfg.startups.gmbh.fixedCostCentsPerQuarter
        : tier === "ag"
          ? cfg.startups.ag.fixedCostCentsPerQuarter
          : (cfg.company.tiers.find((t) => t.id === "small_business")?.fixedCostCentsPerQuarter ?? 0);
  return Math.round(base * (1 + cfg.startups.expansion.fixedCostPerLevel * level(expansionLevel)));
}

/** Places for players and AI workers; every expansion level adds more (ADR-083). */
export function maxEmployees(tier: StartupTier, cfg: BalanceConfig = BALANCE, expansionLevel = 0): number {
  const base =
    tier === "garage"
      ? cfg.startups.garage.maxEmployees
      : tier === "gmbh"
        ? cfg.startups.gmbh.maxEmployees
        : tier === "ag"
          ? cfg.startups.ag.maxEmployees
          : (cfg.company.tiers.find((t) => t.id === "small_business")?.maxEmployees ?? 0);
  return base + cfg.startups.expansion.employeesPerLevel * level(expansionLevel);
}

// ------------------------------------------------------------------ growth without limit (ADR-083)

/** The market the company reaches: niche size × legal form × expansion. */
export function effectivePotentialCents(
  potentialAnnualCents: number,
  tier: StartupTier,
  expansionLevel = 0,
  cfg: StartupsConfig = BALANCE.startups,
): number {
  return (
    potentialAnnualCents *
    cfg.marketFactorByTier[tier] *
    (1 + cfg.expansion.marketBonusPerLevel * level(expansionLevel))
  );
}

/** Capacity factor of the expansion level. */
export function expansionCapacityFactor(expansionLevel = 0, cfg: StartupsConfig = BALANCE.startups): number {
  return 1 + cfg.expansion.capacityBonusPerLevel * level(expansionLevel);
}

/** Whether this legal form can expand at all. */
export function canExpand(tier: StartupTier, cfg: StartupsConfig = BALANCE.startups): boolean {
  return (cfg.expansion.fromTiers as readonly string[]).includes(tier);
}

/** Price of the step from expansion level n to n + 1 (whole cents). Grows geometrically, never ends. */
export function expansionCostCents(currentLevel: number, cfg: StartupsConfig = BALANCE.startups): number {
  return Math.round(cfg.expansion.baseCostCents * Math.pow(cfg.expansion.costGrowth, level(currentLevel)));
}

/** Effect of the price strategy; premium needs quality, or customers stay away. */
export function priceEffect(
  priceLevel: PriceLevel | undefined,
  quality: number,
  cfg: StartupsConfig = BALANCE.startups,
): { price: number; demand: number; awareness: number } {
  const p = cfg.pricing[priceLevel ?? "normal"];
  const scared = priceLevel === "premium" && quality < cfg.pricing.premiumMinQuality;
  return {
    price: p.price,
    demand: scared ? p.demand * cfg.pricing.premiumLowQualityDemand : p.demand,
    awareness: p.awareness,
  };
}

/** Founder productivity in the own company: halved while working elsewhere (ADR-066). */
export function founderFactor(hasJobElsewhere: boolean, cfg: StartupsConfig = BALANCE.startups): number {
  return hasJobElsewhere ? cfg.sideJobFounderFactor : 1;
}

/** From this headcount (players and AI workers) the founder must work full time in the company. */
export function needsFullTimeFounder(headcount: number, cfg: StartupsConfig = BALANCE.startups): boolean {
  return headcount >= cfg.fullTimeFromEmployees;
}

// ------------------------------------------------------------------ going public (ADR-067)

/** Issue price per share in cents: company value spread over all shares, never below the floor. */
export function issuePriceCents(valueCents: bigint, cfg: StartupsConfig = BALANCE.startups): number {
  const perShare = Number(valueCents) / cfg.ipo.sharesTotal;
  return Math.max(cfg.ipo.minIssuePriceCents, Math.round(perShare));
}

/** Share of the unsubscribed shares AI investors take at the end of the subscription. */
export function aiTakeShare(quality: number, cfg: StartupsConfig = BALANCE.startups): number {
  return Math.min(1, Math.max(0, cfg.ipo.aiTakeBase + cfg.ipo.aiTakePerQuality * quality));
}

/** Price of new shares in a capital increase (cents per share). */
export function capitalIncreasePriceCents(marketPriceCents: number, cfg: StartupsConfig = BALANCE.startups): number {
  return Math.max(cfg.ipo.minIssuePriceCents, Math.round(marketPriceCents * cfg.ipo.capitalIncreaseDiscount));
}

/** Closes one quarter of a player company. */
export function closeStartupQuarter(
  state: StartupState,
  input: StartupQuarterInput,
  cfg: BalanceConfig = BALANCE,
): StartupQuarterResult {
  const sc = cfg.startups;
  const potential = effectivePotentialCents(state.potentialAnnualCents, input.tier, input.expansionLevel, sc);
  const quarterPotential = potential / 4;
  const pricing = priceEffect(input.priceLevel, state.quality, sc);

  // Quality moves towards what the team can do; awareness grows by word of mouth and marketing.
  const stage = clamp(Math.floor(input.stage), 0, sc.stages.awarenessCaps.length - 1);
  // AI workers do standard work: the more of the team they are, the lower the reachable quality (ADR-069).
  const aiShare = input.productivityBps.length > 0 ? input.aiWorkers / input.productivityBps.length : 0;
  const target =
    Math.min(1, qualityTarget(input.teamSectorScore, sc) + sc.stages.qualityBonusPerStage * stage) *
    (1 - sc.aiQualityPenalty * aiShare);
  const quality = clamp(state.quality + sc.quality.adjustPerQuarter * (target - state.quality), 0, 1);
  const marketing = Number(input.marketingCents);
  const awareness = clamp(
    state.awareness +
      sc.awareness.growthPerQuarter * pricing.awareness * state.awareness * (1 - state.awareness) * (0.5 + quality) +
      marketingGain(marketing, potential, sc) -
      sc.awareness.decayPerQuarter * state.awareness,
    sc.awareness.min,
    // Without the right specialists a company cannot grow beyond its stage (ADR-062).
    Math.max(sc.awareness.min, sc.stages.awarenessCaps[stage] ?? 1),
  );

  // Demand and capacity count in units at the normal price; the price strategy changes both price and demand.
  const demand =
    quarterPotential * awareness * (0.5 + 0.5 * quality) * Math.exp(sc.demandNoise * input.noise) * pricing.demand;
  const capacity =
    capacityCents(input.productivityBps, input.sector, sc) *
    (1 + sc.stages.capacityBonusPerStage * stage) *
    expansionCapacityFactor(input.expansionLevel, sc);
  const sold = Math.min(demand, capacity);

  const revenueCents = roundToBigInt(sold * pricing.price);
  const cogsCents = roundToBigInt(sold * (1 - sc.grossMargin[input.sector]));
  const fixedCents = BigInt(fixedCostCents(input.tier, cfg, input.expansionLevel));
  const aiWorkerCents = BigInt(input.aiWorkers * sc.aiWorkerCostCentsPerQuarter);
  const operatingProfitCents = revenueCents - cogsCents - fixedCents - aiWorkerCents - input.marketingCents;

  return {
    demandCents: roundToBigInt(demand),
    capacityCents: roundToBigInt(capacity),
    revenueCents,
    cogsCents,
    fixedCents,
    aiWorkerCents,
    marketingCents: input.marketingCents,
    operatingProfitCents,
    utilization: capacity > 0 ? Math.min(1, demand / capacity) : 1,
    next: {
      potentialAnnualCents: state.potentialAnnualCents,
      awareness,
      quality,
      quartersActive: state.quartersActive + 1,
      cashCents: state.cashCents + operatingProfitCents,
    },
  };
}

/** Company value for the rich list: cash plus the annualised profit at a discounted sector P/E. */
export function startupValueCents(
  cashCents: bigint,
  lastQuarterProfitCents: bigint,
  sector: SectorId,
  cfg: BalanceConfig = BALANCE,
): bigint {
  const profit = lastQuarterProfitCents > BigInt(0) ? Number(lastQuarterProfitCents) : 0;
  const earningsValue = 4 * profit * cfg.sectors[sector].peRatio * cfg.startups.valuationPeDiscount;
  const value = cashCents + roundToBigInt(earningsValue);
  return value > BigInt(0) ? value : BigInt(0);
}

/**
 * The owner's estimate of the market size: a range that always contains the truth
 * and narrows each quarter. `u1`, `u2` are uniform numbers in [0, 1).
 */
export function potentialEstimate(
  potentialAnnualCents: number,
  quartersActive: number,
  u1: number,
  u2: number,
  cfg: StartupsConfig = BALANCE.startups,
): { lowCents: number; highCents: number } {
  const spread = cfg.estimate.initialSpread * Math.pow(cfg.estimate.decayPerQuarter, quartersActive);
  return {
    lowCents: Math.round(potentialAnnualCents * Math.exp(-spread * (0.3 + 0.7 * u1))),
    highCents: Math.round(potentialAnnualCents * Math.exp(spread * (0.3 + 0.7 * u2))),
  };
}

// ------------------------------------------------------------------ products and stages (ADR-062)

export function productOf(sector: SectorId, key: string, cfg: StartupsConfig = BALANCE.startups) {
  return cfg.products[sector].find((p) => p.key === key) ?? cfg.products[sector][0]!;
}

/** Highest stage whose skills (and those of all earlier stages) the team knows. */
export function companyStage(
  sector: SectorId,
  productKey: string,
  teamSkills: ReadonlySet<string>,
  cfg: StartupsConfig = BALANCE.startups,
): number {
  const product = productOf(sector, productKey, cfg);
  let stage = 0;
  for (const needed of product.stages) {
    if (!needed.every((skill) => teamSkills.has(skill))) break;
    stage += 1;
  }
  return stage;
}

/** Price of a training for a skill of this tier, and the wage raise it brings. */
export function trainingFor(tier: number, cfg: StartupsConfig = BALANCE.startups) {
  const i = Math.max(0, Math.min(cfg.training.costCentsByTier.length - 1, tier - 1));
  return { costCents: cfg.training.costCentsByTier[i]!, raiseBps: cfg.training.wageRaiseBpsByTier[i]! };
}

// ------------------------------------------------------------------ CEO payout (ADR-086)

/** Whether a payout share is allowed: whole steps from 0 to the maximum. */
export function isValidFounderPayout(bps: number, cfg: StartupsConfig = BALANCE.startups): boolean {
  const { stepBps, maxBps } = cfg.founderPayout;
  return Number.isInteger(bps) && bps >= 0 && bps <= maxBps && bps % stepBps === 0;
}

/**
 * What the founder receives after an hour: the share of a positive profit, rounded down to whole cents, never more
 * than the free cash (cash minus open bills). Losses pay nothing.
 */
export function founderPayoutCents(profitCents: bigint, payoutBps: number, freeCashCents: bigint): bigint {
  if (profitCents <= BigInt(0) || payoutBps <= 0 || freeCashCents <= BigInt(0)) return BigInt(0);
  const share = (profitCents * BigInt(Math.min(10_000, Math.floor(payoutBps)))) / BigInt(10_000);
  return share < freeCashCents ? share : freeCashCents;
}

// ------------------------------------------------------------------ operating hours (ADR-072)

export interface StartupHourInput {
  readonly sector: SectorId;
  readonly tier: StartupTier;
  readonly marketingCentsPerQuarter: bigint;
  /** Productivity of every worker in bps, as in the quarter. */
  readonly productivityBps: readonly number[];
  readonly aiWorkers: number;
  readonly stage: number;
  /** Standard normal draw for the demand noise of this hour. */
  readonly noise: number;
  /** Contract wages of the players for this hour (sum of their hourly wages). */
  readonly playerWagesCents: number;
  /** Price strategy (ADR-083), default normal. */
  readonly priceLevel?: PriceLevel;
  /** Sell unused capacity as contract work (ADR-083), default off. */
  readonly contractWork?: boolean;
  /** Expansion level (ADR-083), default 0. */
  readonly expansionLevel?: number;
  /** Active company event (ADR-091): demand, capacity and extra costs of this hour. */
  readonly event?: { readonly demandFactor: number; readonly capacityFactor: number; readonly extraCostShare: number };
}

export interface StartupHourResult {
  readonly demandCents: bigint;
  readonly capacityCents: bigint;
  /** All revenue of the hour, contract work included. */
  readonly revenueCents: bigint;
  /** Part of the revenue from contract work (ADR-083). */
  readonly contractRevenueCents: bigint;
  readonly cogsCents: bigint;
  readonly fixedCents: bigint;
  readonly marketingCents: bigint;
  /** Share of the wages paid this hour: never more than revenue minus goods (ADR-072). */
  readonly payFactorBps: number;
  readonly playerWagesPaidCents: bigint;
  readonly aiWagesPaidCents: bigint;
  /** Revenue minus goods, wages paid, fixed costs and marketing. */
  readonly profitCents: bigint;
}

/**
 * One operating hour (ADR-072). Sales use the quarter's awareness and quality; players and AI workers are paid in
 * the same hour, all with the same factor, and never with more than the hour earned (revenue minus goods).
 */
export function closeStartupHour(
  state: StartupState,
  input: StartupHourInput,
  cfg: BalanceConfig = BALANCE,
): StartupHourResult {
  const sc = cfg.startups;
  const hours = cfg.time.quarterHours;
  const stage = clamp(Math.floor(input.stage), 0, sc.stages.awarenessCaps.length - 1);
  const pricing = priceEffect(input.priceLevel, state.quality, sc);
  const potential = effectivePotentialCents(state.potentialAnnualCents, input.tier, input.expansionLevel, sc);
  // Demand and capacity count in units at the normal price (see closeStartupQuarter).
  const demand =
    (potential / 4 / hours) *
    state.awareness *
    (0.5 + 0.5 * state.quality) *
    Math.exp(sc.demandNoise * input.noise) *
    pricing.demand *
    (input.event?.demandFactor ?? 1);
  const capacity =
    (capacityCents(input.productivityBps, input.sector, sc) *
      (1 + sc.stages.capacityBonusPerStage * stage) *
      expansionCapacityFactor(input.expansionLevel, sc) *
      (input.event?.capacityFactor ?? 1)) /
    hours;
  const sold = Math.min(demand, capacity);
  const contract = input.contractWork ? (capacity - sold) * sc.contractWork.shareOfFreeCapacity : 0;
  const ownRevenueCents = roundToBigInt(sold * pricing.price);
  const contractRevenueCents = roundToBigInt(contract);
  const revenueCents = ownRevenueCents + contractRevenueCents;
  // An event's extra costs (or savings) move with the revenue; goods never cost less than nothing.
  const eventCost = Number(ownRevenueCents) * (input.event?.extraCostShare ?? 0);
  const cogsCents =
    roundToBigInt(Math.max(0, sold * (1 - sc.grossMargin[input.sector]) + eventCost)) +
    roundToBigInt(contract * (1 - sc.contractWork.grossMargin));
  const gross = Number(revenueCents - cogsCents);

  const aiDue = input.aiWorkers * sc.aiWorkerWageCentsPerHour;
  const due = aiDue + Math.max(0, input.playerWagesCents);
  const payFactorBps = due <= 0 ? 10_000 : clamp(Math.floor((Math.max(0, gross) * 10_000) / due), 0, 10_000);
  const aiWagesPaidCents = BigInt(Math.floor((aiDue * payFactorBps) / 10_000));
  const playerWagesPaidCents = BigInt(Math.floor((Math.max(0, input.playerWagesCents) * payFactorBps) / 10_000));

  const fixedCents = BigInt(Math.round(fixedCostCents(input.tier, cfg, input.expansionLevel) / hours));
  const marketingCents = BigInt(Math.round(Number(input.marketingCentsPerQuarter) / hours));
  return {
    demandCents: roundToBigInt(demand),
    capacityCents: roundToBigInt(capacity),
    revenueCents,
    contractRevenueCents,
    cogsCents,
    fixedCents,
    marketingCents,
    payFactorBps,
    playerWagesPaidCents,
    aiWagesPaidCents,
    profitCents: revenueCents - cogsCents - playerWagesPaidCents - aiWagesPaidCents - fixedCents - marketingCents,
  };
}
