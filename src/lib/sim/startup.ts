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

export function initialStartup(potentialAnnualCents: number, cashCents: bigint, cfg = BALANCE.startups): StartupState {
  return {
    potentialAnnualCents,
    awareness: cfg.awareness.initial,
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

/** Revenue the team can serve per quarter. */
export function capacityCents(
  productivityBps: readonly number[],
  sector: SectorId,
  cfg: StartupsConfig = BALANCE.startups,
): number {
  const units = productivityBps.reduce((sum, p) => sum + p / 10_000, 0);
  return units * cfg.capacityCentsPerProductivity[sector];
}

export function fixedCostCents(tier: StartupTier, cfg: BalanceConfig = BALANCE): number {
  if (tier === "garage") return cfg.startups.garage.fixedCostCentsPerQuarter;
  if (tier === "gmbh") return cfg.startups.gmbh.fixedCostCentsPerQuarter;
  if (tier === "ag") return cfg.startups.ag.fixedCostCentsPerQuarter;
  return cfg.company.tiers.find((t) => t.id === "small_business")?.fixedCostCentsPerQuarter ?? 0;
}

export function maxEmployees(tier: StartupTier, cfg: BalanceConfig = BALANCE): number {
  if (tier === "garage") return cfg.startups.garage.maxEmployees;
  if (tier === "gmbh") return cfg.startups.gmbh.maxEmployees;
  if (tier === "ag") return cfg.startups.ag.maxEmployees;
  return cfg.company.tiers.find((t) => t.id === "small_business")?.maxEmployees ?? 0;
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
  const quarterPotential = state.potentialAnnualCents / 4;

  // Quality moves towards what the team can do; awareness grows by word of mouth and marketing.
  const stage = clamp(Math.floor(input.stage), 0, sc.stages.awarenessCaps.length - 1);
  const target = Math.min(1, qualityTarget(input.teamSectorScore, sc) + sc.stages.qualityBonusPerStage * stage);
  const quality = clamp(state.quality + sc.quality.adjustPerQuarter * (target - state.quality), 0, 1);
  const marketing = Number(input.marketingCents);
  const awareness = clamp(
    state.awareness +
      sc.awareness.growthPerQuarter * state.awareness * (1 - state.awareness) * (0.5 + quality) +
      marketingGain(marketing, state.potentialAnnualCents, sc) -
      sc.awareness.decayPerQuarter * state.awareness,
    sc.awareness.min,
    // Without the right specialists a company cannot grow beyond its stage (ADR-062).
    Math.max(sc.awareness.min, sc.stages.awarenessCaps[stage] ?? 1),
  );

  const demand = quarterPotential * awareness * (0.5 + 0.5 * quality) * Math.exp(sc.demandNoise * input.noise);
  const capacity =
    capacityCents(input.productivityBps, input.sector, sc) * (1 + sc.stages.capacityBonusPerStage * stage);
  const revenue = Math.min(demand, capacity);

  const revenueCents = roundToBigInt(revenue);
  const cogsCents = roundToBigInt(revenue * (1 - sc.grossMargin[input.sector]));
  const fixedCents = BigInt(fixedCostCents(input.tier, cfg));
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
