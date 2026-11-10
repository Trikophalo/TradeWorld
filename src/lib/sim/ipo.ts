/**
 * IPO (spec 6.5): requirement check, price range of the AI underwriter,
 * AI fund demand and bookbuilding result.
 */
import { BALANCE } from "../../config/balance.ts";
import type { IpoConfig, ReputationConfig } from "../../config/balance.ts";
import { reputationValuationFactor } from "./fair-value.ts";
import { ZERO, roundToBigInt, sumBig } from "./money.ts";
import type { Rng } from "./types.ts";

export interface IpoRequirementInput {
  readonly founderLevel: number;
  readonly founderReputation: number;
  readonly historyQuarters: number;
  readonly trailingRevenueCents: bigint;
  readonly hasCfo: boolean;
  /** Offered shares / shares outstanding after the IPO, in bps. */
  readonly floatBps: number;
}

export type IpoRequirementKey = "level" | "history" | "revenue" | "reputation" | "cfo" | "float";

/** Unmet IPO requirements (empty = ready). Drives the IPO checklist in the UI. */
export function unmetIpoRequirements(input: IpoRequirementInput, cfg: IpoConfig = BALANCE.ipo): IpoRequirementKey[] {
  const unmet: IpoRequirementKey[] = [];
  if (input.founderLevel < cfg.minLevel) unmet.push("level");
  if (input.historyQuarters < cfg.minHistoryQuarters) unmet.push("history");
  if (input.trailingRevenueCents < BigInt(cfg.minTrailingRevenueCents)) unmet.push("revenue");
  if (input.founderReputation < cfg.minReputation) unmet.push("reputation");
  if (cfg.requiresCfo && !input.hasCfo) unmet.push("cfo");
  if (input.floatBps < cfg.minFloatBps || input.floatBps > cfg.maxFloatBps) unmet.push("float");
  return unmet;
}

export interface IpoPriceRange {
  readonly lowE4: bigint;
  readonly midE4: bigint;
  readonly highE4: bigint;
}

/** Price range of the underwriter: fair value minus the IPO discount, +- half width. */
export function suggestIpoPriceRange(fairValueE4: bigint, cfg: IpoConfig = BALANCE.ipo): IpoPriceRange {
  const fair = Number(fairValueE4);
  const mid = fair * (1 - cfg.discountBps / 10_000);
  const half = cfg.rangeHalfWidthBps / 10_000;
  const one = BigInt(1);
  const lowE4 = roundToBigInt(Math.max(1, Math.floor(mid * (1 - half))));
  let midE4 = roundToBigInt(Math.max(1, Math.round(mid)));
  let highE4 = roundToBigInt(Math.max(1, Math.ceil(mid * (1 + half))));
  if (midE4 < lowE4) midE4 = lowE4;
  if (highE4 <= lowE4) highE4 = lowE4 + one;
  if (midE4 > highE4) midE4 = highE4;
  return { lowE4, midE4, highE4 };
}

export interface AiIpoDemandInput {
  readonly offeredShares: bigint;
  readonly fairValueE4: bigint;
  readonly range: IpoPriceRange;
  readonly founderReputation: number;
  /** Sector / market sentiment in [-1, 1]. */
  readonly sentiment: number;
}

/**
 * Shares subscribed by the AI funds. Coverage grows with the discount to fair
 * value, the founder's reputation and sentiment; a noise term keeps it uncertain.
 */
export function aiIpoDemandShares(
  input: AiIpoDemandInput,
  rng: Rng,
  cfg: IpoConfig = BALANCE.ipo,
  reputationCfg: ReputationConfig = BALANCE.reputation,
): bigint {
  const mid = Math.max(1, Number(input.range.midE4));
  const cheapness = Math.pow(Math.max(1, Number(input.fairValueE4)) / mid, cfg.aiDemand.priceElasticity);
  const reputation = reputationValuationFactor(input.founderReputation, reputationCfg);
  const sentiment = Math.max(0, 1 + cfg.aiDemand.sentimentWeight * Math.min(1, Math.max(-1, input.sentiment)));
  const noise = Math.exp(rng.normal(0, cfg.aiDemand.noise));
  const coverage = cfg.aiDemand.baseCoverage * cheapness * reputation * sentiment * noise;
  return roundToBigInt(Math.floor(Number(input.offeredShares) * coverage));
}

export interface BookbuildingResult {
  readonly status: "priced" | "failed";
  /** Subscribed / offered. */
  readonly coverage: number;
  /** Issue price, `null` if the IPO failed. */
  readonly priceE4: bigint | null;
  /** Share of every subscription that gets allocated (pro rata), 0 on failure. */
  readonly allocationRatio: number;
}

/**
 * Bookbuilding (spec 6.5): undersubscribed -> the IPO fails; fully covered ->
 * priced inside the range, at the top once coverage reaches `fullPriceCoverage`.
 * Oversubscription is allocated pro rata.
 */
export function resolveBookbuilding(
  offeredShares: bigint,
  subscriptions: readonly bigint[],
  range: IpoPriceRange,
  cfg: IpoConfig = BALANCE.ipo,
): BookbuildingResult {
  if (offeredShares <= ZERO) throw new RangeError("offeredShares must be > 0");
  const subscribed = sumBig(subscriptions.map((s) => (s > ZERO ? s : ZERO)));
  const coverage = Number(subscribed) / Number(offeredShares);
  if (coverage < cfg.minCoverage) return { status: "failed", coverage, priceE4: null, allocationRatio: 0 };

  const span = cfg.fullPriceCoverage - cfg.minCoverage;
  const t = span > 0 ? Math.min(1, (coverage - cfg.minCoverage) / span) : 1;
  const low = Number(range.lowE4);
  const high = Number(range.highE4);
  const priceE4 = roundToBigInt(Math.round(low + (high - low) * t));
  return { status: "priced", coverage, priceE4, allocationRatio: Math.min(1, 1 / coverage) };
}

/** Pro-rata allocation of one subscription, rounded down (the rest stays with the underwriter). */
export function allocateSubscription(subscribedShares: bigint, offeredShares: bigint, totalSubscribed: bigint): bigint {
  if (subscribedShares <= ZERO || totalSubscribed <= ZERO) return ZERO;
  if (totalSubscribed <= offeredShares) return subscribedShares;
  return (subscribedShares * offeredShares) / totalSubscribed;
}
