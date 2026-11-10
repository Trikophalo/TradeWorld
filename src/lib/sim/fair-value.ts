/**
 * Fair value, the price anchor of the AI investors (spec 5.3):
 *
 *   fairValue = EPS x sectorPE x growthFactor x reputationFactor x macroFactor
 *
 * EPS is the trailing four quarter (one game year) earnings per share.
 */
import { BALANCE } from "../../config/balance.ts";
import type { CentralBankConfig, ReputationConfig, SectorConfig, ValuationConfig } from "../../config/balance.ts";
import type { Rng } from "./types.ts";
import { roundToBigInt } from "./money.ts";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Maps reputation 0..100 linearly to 0.6..1.4 (50 = 1.0). */
export function reputationValuationFactor(reputation: number, cfg: ReputationConfig = BALANCE.reputation): number {
  const r = clamp(reputation, cfg.min, cfg.max);
  const t = (r - cfg.min) / (cfg.max - cfg.min);
  return cfg.valuationFactorMin + (cfg.valuationFactorMax - cfg.valuationFactorMin) * t;
}

/**
 * Macro factor from the policy rate: 1 at the neutral rate, lower when rates are
 * higher (bonds become more attractive, future profits are discounted harder).
 * `sectorSensitivity` scales the effect (tech reacts stronger than retail).
 */
export function macroFactor(
  policyRateBps: number,
  sectorSensitivity = 1,
  valuation: ValuationConfig = BALANCE.valuation,
  centralBank: CentralBankConfig = BALANCE.centralBank,
): number {
  const hundredsOfBps = (policyRateBps - centralBank.neutralRateBps) / 100;
  const factor = 1 - valuation.macroSensitivityPer100Bps * sectorSensitivity * hundredsOfBps;
  return clamp(factor, valuation.macroFactorMin, valuation.macroFactorMax);
}

/** Growth factor from trailing revenue growth (0.1 = +10 % per game year). */
export function growthFactor(revenueGrowth: number, cfg: ValuationConfig = BALANCE.valuation): number {
  return clamp(1 + cfg.growthWeight * revenueGrowth, cfg.growthFactorMin, cfg.growthFactorMax);
}

/** Revenue growth of the last four quarters against the four before, 0 without enough history. */
export function trailingRevenueGrowth(revenueHistoryCents: readonly bigint[]): number {
  if (revenueHistoryCents.length < 8) return 0;
  const last8 = revenueHistoryCents.slice(-8);
  let previous = 0;
  let recent = 0;
  last8.forEach((value, i) => {
    if (i < 4) previous += Number(value);
    else recent += Number(value);
  });
  if (previous <= 0) return 0;
  return recent / previous - 1;
}

export interface FairValueInput {
  /** Trailing four quarter earnings per share in cents (may be negative or fractional). */
  readonly epsTtmCents: number;
  readonly sector: Pick<SectorConfig, "peRatio" | "sensitivity">;
  readonly revenueGrowth: number;
  /** Founder reputation 0..100, `null` for AI companies (factor 1). */
  readonly founderReputation: number | null;
  readonly policyRateBps: number;
  /** Book value per share in cents, used as a floor for loss makers. */
  readonly bookValuePerShareCents: number;
  /** Binary event factor (pharma pipeline), 1 = neutral. */
  readonly eventValueFactor?: number;
}

export interface FairValueConfig {
  readonly valuation: ValuationConfig;
  readonly reputation: ReputationConfig;
  readonly centralBank: CentralBankConfig;
  readonly minPriceE4: number;
}

const DEFAULT_FAIR_VALUE_CONFIG: FairValueConfig = {
  valuation: BALANCE.valuation,
  reputation: BALANCE.reputation,
  centralBank: BALANCE.centralBank,
  minPriceE4: BALANCE.trading.minPriceE4,
};

/**
 * Fair value per share as an E4 price.
 *
 * Loss-making companies have no meaningful earnings multiple. Their fair value
 * falls back to a share of the book value (liquidation view), still scaled by
 * reputation, macro and event factors. The result is never below `minPriceE4`.
 */
export function fairValueE4(input: FairValueInput, cfg: FairValueConfig = DEFAULT_FAIR_VALUE_CONFIG): bigint {
  const reputation =
    input.founderReputation === null ? 1 : reputationValuationFactor(input.founderReputation, cfg.reputation);
  const macro = macroFactor(
    input.policyRateBps,
    input.sector.sensitivity.valuationRate,
    cfg.valuation,
    cfg.centralBank,
  );
  const event = input.eventValueFactor ?? 1;
  const common = reputation * macro * event;

  const earningsValueCents =
    Math.max(0, input.epsTtmCents) * input.sector.peRatio * growthFactor(input.revenueGrowth, cfg.valuation);
  const floorCents = Math.max(0, input.bookValuePerShareCents) * cfg.valuation.bookValueFloorShare;
  const valueCents = Math.max(earningsValueCents, floorCents) * common;

  const valueE4 = roundToBigInt(valueCents * 100);
  const min = BigInt(cfg.minPriceE4);
  return valueE4 < min ? min : valueE4;
}

/**
 * Analyst price target (unlock level 7): the fair value plus noise, and with some
 * probability simply wrong (noise in the opposite direction, three times as large).
 */
export function analystPriceTargetE4(fairValue: bigint, rng: Rng, cfg: ValuationConfig = BALANCE.valuation): bigint {
  const wrong = rng.chance(cfg.analystWrongProbability);
  const noise = rng.normal(0, cfg.analystTargetNoise) * (wrong ? 3 : 1);
  const target = roundToBigInt(Number(fairValue) * Math.exp(noise));
  return target < BigInt(1) ? BigInt(1) : target;
}
