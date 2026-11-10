/**
 * Liquidity, price impact and slippage (spec 5.3 and 10, ADR-005).
 *
 * One "depth" is the number of shares that moves the price by
 * `impactBpsPerDepth` (1 %). Impact is linear in the default config:
 *
 *   impact(q) = impactBpsPerDepth / 10 000 x (|q| / depth) ^ exponent
 *
 * Linear impact is split-invariant: cutting an order into pieces neither helps
 * nor hurts, so there is nothing to gain from order spam. The same function
 * converts the net pressure of the AI investors into a return.
 */
import { BALANCE } from "../../config/balance.ts";
import type { TimeConfig, TradingConfig } from "../../config/balance.ts";
import type { MarketSession, Quote } from "./types.ts";
import { ZERO, orderValueCents, roundToBigInt } from "./money.ts";

type ImpactConfig = TradingConfig["priceImpact"];

/** Shares that move the price by `impactBpsPerDepth`. Thinner after hours. */
export function depthShares(
  freeFloatShares: bigint,
  session: MarketSession,
  impact: ImpactConfig = BALANCE.trading.priceImpact,
  afterHours: TimeConfig["afterHours"] = BALANCE.time.afterHours,
): number {
  const sessionFactor = session === "open" ? 1 : afterHours.liquidityMultiplier;
  return Math.max(1, Number(freeFloatShares) * impact.depthFreeFloatFraction * sessionFactor);
}

/** Signed relative price move caused by a signed net quantity (positive = buying). */
export function impactReturn(
  netShares: number,
  depth: number,
  impact: ImpactConfig = BALANCE.trading.priceImpact,
): number {
  if (netShares === 0 || depth <= 0) return 0;
  const magnitude = (impact.impactBpsPerDepth / 10_000) * Math.pow(Math.abs(netShares) / depth, impact.exponent);
  return Math.sign(netShares) * magnitude;
}

/** Largest quantity a single order may take before `maxImpactBpsPerOrder` is reached. */
export function maxFillableShares(depth: number, impact: ImpactConfig = BALANCE.trading.priceImpact): bigint {
  const ratio = Math.pow(impact.maxImpactBpsPerOrder / impact.impactBpsPerDepth, 1 / impact.exponent);
  return roundToBigInt(Math.floor(depth * ratio));
}

export interface SlippageEstimate {
  readonly filledQuantity: bigint;
  readonly unfilledQuantity: bigint;
  /** Price of the first share (best bid or ask). */
  readonly touchPriceE4: bigint;
  readonly averagePriceE4: bigint;
  /** Price of the last share. */
  readonly worstPriceE4: bigint;
  /** Average price against the touch price, always >= 0. */
  readonly slippageBps: number;
  readonly valueCents: bigint;
  /** Relative move of the mid price right after the trade (signed). */
  readonly immediateMidReturn: number;
}

/**
 * Closed-form estimate of a market order against the market-maker liquidity
 * (order preview in the UI and fast path of the execution RPC). The exact fill
 * against a concrete book including player limit orders is `walkBook()`.
 *
 * Walking a book of uniform density from the touch price gives an average price
 * of `touch x (1 +- impact(q) / (exponent + 1))`, i.e. half the full impact in
 * the linear case.
 */
export function estimateMarketOrder(
  side: "buy" | "sell",
  quantity: bigint,
  quote: Quote,
  depth: number,
  impact: ImpactConfig = BALANCE.trading.priceImpact,
): SlippageEstimate {
  if (quantity <= ZERO) throw new RangeError("quantity must be > 0");
  const maxFill = maxFillableShares(depth, impact);
  const filledQuantity = quantity > maxFill ? maxFill : quantity;
  const direction = side === "buy" ? 1 : -1;
  const touchPriceE4 = side === "buy" ? quote.askE4 : quote.bidE4;
  const fullImpact = Math.abs(impactReturn(Number(filledQuantity), depth, impact));
  const averageMove = fullImpact / (impact.exponent + 1);

  const touch = Number(touchPriceE4);
  const averagePriceE4 = atLeastOne(roundToBigInt(touch * (1 + direction * averageMove)));
  const worstPriceE4 = atLeastOne(roundToBigInt(touch * (1 + direction * fullImpact)));
  return {
    filledQuantity,
    unfilledQuantity: quantity - filledQuantity,
    touchPriceE4,
    averagePriceE4,
    worstPriceE4,
    slippageBps: averageMove * 10_000,
    valueCents: orderValueCents(filledQuantity, averagePriceE4),
    immediateMidReturn: direction * fullImpact * impact.immediateShare,
  };
}

function atLeastOne(value: bigint): bigint {
  return value < BigInt(1) ? BigInt(1) : value;
}
