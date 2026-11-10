/**
 * Market maker: quotes with spread and the synthetic order book (ADR-005).
 */
import { BALANCE } from "../../config/balance.ts";
import type { SizeClass, TimeConfig, TradingConfig } from "../../config/balance.ts";
import type { MarketSession, OrderBook, OrderBookLevel, Quote, Rng } from "./types.ts";
import { ONE, roundToBigInt } from "./money.ts";

/**
 * Half spread in bps: base per size class, wider when sentiment is extreme
 * (nervous market) and multiplied after hours.
 */
export function halfSpreadBps(
  sizeClass: SizeClass,
  session: MarketSession,
  sentiment = 0,
  trading: TradingConfig = BALANCE.trading,
  afterHours: TimeConfig["afterHours"] = BALANCE.time.afterHours,
): number {
  const base = trading.spread.halfSpreadBps[sizeClass];
  const nervous = trading.spread.sentimentWideningBps * Math.min(1, Math.abs(sentiment));
  const sessionFactor = session === "open" ? 1 : afterHours.spreadMultiplier;
  return (base + nervous) * sessionFactor;
}

/** Bid and ask around a mid price. Guarantees `1 <= bid < ask`. */
export function quoteAround(midE4: bigint, halfSpread: number, trading: TradingConfig = BALANCE.trading): Quote {
  const minPrice = BigInt(trading.minPriceE4);
  const mid = midE4 < minPrice ? minPrice : midE4;
  const minHalf = BigInt(trading.spread.minHalfSpreadE4);
  let half = roundToBigInt((Number(mid) * halfSpread) / 10_000);
  if (half < minHalf) half = minHalf;
  let bidE4 = mid - half;
  if (bidE4 < minPrice) bidE4 = minPrice;
  let askE4 = mid + half;
  if (askE4 <= bidE4) askE4 = bidE4 + ONE;
  return { bidE4, askE4, midE4: mid, halfSpreadBps: halfSpread };
}

/**
 * Synthetic market-maker levels around the quote.
 *
 * Level i sits `i x levelStepBps` away from the touch price and offers
 * `depth x levelStepBps / impactBpsPerDepth` shares. Walking these levels
 * therefore reproduces the linear impact function: consuming one depth of shares
 * reaches a price `impactBpsPerDepth` away from the touch.
 *
 * `rng` only adds cosmetic size jitter. Pass a stream derived from
 * (seed, tick, security) so every client sees the same book.
 */
export function synthesizeOrderBook(
  quote: Quote,
  depth: number,
  rng: Rng | null = null,
  trading: TradingConfig = BALANCE.trading,
): OrderBook {
  const { levelsPerSide, levelStepBps, sizeJitter } = trading.orderBook;
  const baseQuantity = (depth * levelStepBps) / trading.priceImpact.impactBpsPerDepth;
  const minPrice = BigInt(trading.minPriceE4);
  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];

  const quantityFor = (): bigint => {
    const jitter = rng ? 1 + sizeJitter * (2 * rng.next() - 1) : 1;
    const q = roundToBigInt(Math.floor(baseQuantity * jitter));
    return q < ONE ? ONE : q;
  };

  let lastBid: bigint | null = null;
  let lastAsk: bigint | null = null;
  for (let i = 0; i < levelsPerSide; i++) {
    const offset = (i * levelStepBps) / 10_000;

    let bidPrice = roundToBigInt(Math.floor(Number(quote.bidE4) * (1 - offset)));
    if (lastBid !== null && bidPrice >= lastBid) bidPrice = lastBid - ONE;
    if (bidPrice >= minPrice) {
      bids.push({ side: "bid", priceE4: bidPrice, quantity: quantityFor(), source: "market_maker" });
      lastBid = bidPrice;
    }

    let askPrice = roundToBigInt(Math.ceil(Number(quote.askE4) * (1 + offset)));
    if (lastAsk !== null && askPrice <= lastAsk) askPrice = lastAsk + ONE;
    asks.push({ side: "ask", priceE4: askPrice, quantity: quantityFor(), source: "market_maker" });
    lastAsk = askPrice;
  }
  return { bids, asks };
}
