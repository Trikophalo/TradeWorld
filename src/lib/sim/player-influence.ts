/**
 * Players move prices (owner decision, ADR-056, docs/SIMULATION.md "Spielergetriebene Kurse").
 *
 * Three forces set a price:
 *  1. player orders, measured in euros (a few players move a stock, many decide it),
 *  2. company success (fair value) plus a premium for what players hold,
 *  3. AI traders (noise, momentum, herd), which fade as player activity grows.
 */
import { BALANCE } from "../../config/balance.ts";
import type { AiInvestorsConfig, SizeClass, TradingConfig } from "../../config/balance.ts";

/** Value in cents of `shares` at `priceE4` (as number; display and simulation only). */
export function sharesValueCents(shares: number, priceE4: number): number {
  return (shares * priceE4) / 100;
}

/**
 * Log return caused by net player buying (`netShares` > 0) or selling, linear in euros:
 * `depthCentsPer100Bps` of net buying moves the price by 1 %.
 */
export function playerImpactReturn(
  netShares: number,
  priceE4: number,
  sizeClass: SizeClass | "bond",
  cfg: TradingConfig["playerImpact"] = BALANCE.trading.playerImpact,
): number {
  if (netShares === 0 || priceE4 <= 0) return 0;
  const depth = sizeClass === "bond" ? cfg.bondDepthCentsPer100Bps : cfg.depthCentsPer100Bps[sizeClass];
  return (0.01 * sharesValueCents(netShares, priceE4)) / depth;
}

/**
 * Fair value the value funds accept: company success times a premium for the
 * value players hold, `1 + maxPremium × tanh(held / (scale × depth))`.
 */
export function anchoredFairValue(
  fairValueE4: number,
  playerHeldShares: number,
  priceE4: number,
  sizeClass: SizeClass,
  cfg: TradingConfig["playerImpact"] = BALANCE.trading.playerImpact,
): number {
  const held = Math.max(0, sharesValueCents(playerHeldShares, priceE4));
  const scale = cfg.premiumScaleDepths * cfg.depthCentsPer100Bps[sizeClass];
  return fairValueE4 * (1 + cfg.maxHoldingsPremium * Math.tanh(held / scale));
}

/** Per-tick decay of the player activity for the configured half-life. */
export function activityDecay(
  tickSeconds: number,
  cfg: AiInvestorsConfig["playerWeight"] = BALANCE.aiInvestors.playerWeight,
): number {
  return Math.pow(0.5, tickSeconds / (cfg.activityHalfLifeHours * 3600));
}

/** Next player activity (cents): decayed old value plus this tick's traded player volume. */
export function nextActivityCents(
  activityCents: number,
  tradedCents: number,
  tickSeconds: number,
  cfg: AiInvestorsConfig["playerWeight"] = BALANCE.aiInvestors.playerWeight,
): number {
  return activityCents * activityDecay(tickSeconds, cfg) + Math.abs(tradedCents);
}

/** Weight of the AI traders: 1 without players, falling towards `minAiWeight` as players trade. */
export function aiWeight(
  activityCents: number,
  sizeClass: SizeClass,
  cfg: AiInvestorsConfig["playerWeight"] = BALANCE.aiInvestors.playerWeight,
): number {
  const reference = cfg.referenceActivityCents[sizeClass];
  return Math.max(cfg.minAiWeight, reference / (reference + Math.max(0, activityCents)));
}
