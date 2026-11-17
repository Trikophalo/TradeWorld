/**
 * Reputation of every player company (ADR-183). Before, only listed companies had a reputation (ADR-167), and it
 * moved only with payouts, dividends, investments and scandals: a well-run company without those stayed at exactly
 * 50 forever, and private companies had none at all. Now every closed hour judges how the company treats its
 * customers and staff (quality, delivery, price, wages, bills, crises, campaigns); listed companies add their
 * shareholder drivers on top (`reputationTarget` in listed.ts). The value moves a step toward the target each hour
 * and lifts or lowers the demand.
 *
 * Mirrored 1:1 in SQL (company_reputation_drivers, company_reputation_step; migration 20261204007300).
 * Pure: no clock, no randomness.
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig } from "../../config/balance.ts";
import type { PriceLevel } from "./startup.ts";

export type ReputationConfig = BalanceConfig["companyHealth"]["reputation"];

export const REPUTATION_DRIVERS = ["quality", "delivery", "price", "wages", "bills", "crisis", "campaign"] as const;
export type ReputationDriverKey = (typeof REPUTATION_DRIVERS)[number];
export type ReputationDrivers = Readonly<Record<ReputationDriverKey, number>>;

/** What a closed hour shows about the company's customers and staff. */
export interface ReputationHour {
  /** 0..1 */
  readonly quality: number;
  readonly demandCents: number;
  readonly capacityCents: number;
  readonly priceLevel: PriceLevel;
  /** Share of the wages paid (bps, 10 000 = all). */
  readonly payFactorBps: number;
  /** Open bills after the hour. */
  readonly unpaidCents: number;
  /** Highest severity (1..3) of an open or running crisis, 0 for none. */
  readonly crisisSeverity: number;
  /** A marketing campaign runs this hour. */
  readonly campaign: boolean;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Points each operational driver adds to (or takes from) the target; 0 is neutral. */
export function reputationDrivers(
  h: ReputationHour,
  cfg: ReputationConfig = BALANCE.companyHealth.reputation,
  premiumMinQuality: number = BALANCE.startups.pricing.premiumMinQuality,
): ReputationDrivers {
  const quality = clamp(h.quality, 0, 1);
  const neutral = clamp(cfg.qualityNeutral, 0.01, 0.99);
  const q = quality >= neutral ? (quality - neutral) / (1 - neutral) : (quality - neutral) / neutral;
  const qualityPoints = q >= 0 ? cfg.qualityMax * q : cfg.qualityMaxLoss * q;
  const served = h.demandCents > 0 ? clamp(h.capacityCents / h.demandCents, 0, 1) : 1;
  const paid = clamp(h.payFactorBps / 10_000, 0, 1);
  return {
    quality: qualityPoints,
    delivery: -cfg.deliveryMaxLoss * (1 - served),
    price:
      h.priceLevel === "premium" && quality < premiumMinQuality
        ? -cfg.premiumLowQualityLoss
        : h.priceLevel === "budget"
          ? cfg.budgetGain
          : 0,
    wages: -cfg.wagesMaxLoss * (1 - paid),
    bills: h.unpaidCents > 0 ? -cfg.billsLoss : 0,
    crisis: -cfg.crisisPerSeverity * clamp(Math.floor(h.crisisSeverity), 0, 3),
    campaign: h.campaign ? cfg.campaignGain : 0,
  };
}

/**
 * Where the reputation is heading: the base (or, for a listed company, its shareholder target from
 * `reputationTarget`, which already holds the base) plus the operational drivers, 0..100.
 */
export function reputationTargetAll(
  drivers: ReputationDrivers,
  listedTarget: number | null = null,
  cfg: ReputationConfig = BALANCE.companyHealth.reputation,
): number {
  const sum = REPUTATION_DRIVERS.reduce((s, k) => s + (drivers[k] ?? 0), 0);
  return clamp((listedTarget ?? cfg.base) + sum, 0, 100);
}

/** One hour: the value closes `rate` of the gap to the target. */
export function reputationStep(value: number, target: number, rate: number): number {
  return clamp(value + rate * (target - value), 0, 100);
}

/** Demand factor of the reputation: 50 is neutral, 0 and 100 move the demand by `demandMaxEffect`. */
export function reputationDemandFactor(
  value: number,
  cfg: ReputationConfig = BALANCE.companyHealth.reputation,
): number {
  return 1 + (cfg.demandMaxEffect * (clamp(value, 0, 100) - 50)) / 50;
}
