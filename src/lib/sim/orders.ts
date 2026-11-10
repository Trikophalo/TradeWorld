/**
 * Order matching helpers: merging player limit orders into the synthetic book
 * and walking the book for a market or marketable limit order.
 *
 * These functions only compute fills. Booking money and shares happens in
 * PL/pgSQL (ADR-004, ADR-008).
 */
import type { ExecutionResult, Fill, OrderBook, OrderBookLevel, Quote } from "./types.ts";
import { ZERO, divRoundHalfEven, orderValueCents } from "./money.ts";

/**
 * Merges synthetic market-maker levels with real player limit orders.
 * Bids are sorted from high to low, asks from low to high. At the same price
 * player orders come first (in the given order = time priority), so real
 * players get filled before the market maker.
 */
export function mergeOrderBook(synthetic: OrderBook, playerLevels: readonly OrderBookLevel[]): OrderBook {
  const sortSide = (levels: OrderBookLevel[], descending: boolean): OrderBookLevel[] =>
    levels
      .map((level, index) => ({ level, index }))
      .sort((a, b) => {
        if (a.level.priceE4 !== b.level.priceE4) {
          const less = a.level.priceE4 < b.level.priceE4;
          return descending ? (less ? 1 : -1) : less ? -1 : 1;
        }
        if (a.level.source !== b.level.source) return a.level.source === "player" ? -1 : 1;
        return a.index - b.index;
      })
      .map((entry) => entry.level);

  const playerBids = playerLevels.filter((l) => l.side === "bid" && l.quantity > ZERO);
  const playerAsks = playerLevels.filter((l) => l.side === "ask" && l.quantity > ZERO);
  return {
    bids: sortSide([...playerBids, ...synthetic.bids], true),
    asks: sortSide([...playerAsks, ...synthetic.asks], false),
  };
}

/**
 * Fills `quantity` against the opposite side of the book (asks for a buy, bids
 * for a sell). `levels` must be sorted best price first. An optional limit price
 * stops the walk. Each fill is valued separately with half-even rounding.
 */
export function walkBook(
  side: "buy" | "sell",
  quantity: bigint,
  levels: readonly OrderBookLevel[],
  limitPriceE4?: bigint,
): ExecutionResult {
  if (quantity <= ZERO) throw new RangeError("quantity must be > 0");
  const fills: Fill[] = [];
  let remaining = quantity;
  let valueCents = ZERO;
  let notionalE4 = ZERO;

  for (const level of levels) {
    if (remaining <= ZERO) break;
    if (limitPriceE4 !== undefined) {
      if (side === "buy" && level.priceE4 > limitPriceE4) break;
      if (side === "sell" && level.priceE4 < limitPriceE4) break;
    }
    if (level.quantity <= ZERO) continue;
    const take = level.quantity < remaining ? level.quantity : remaining;
    const fill: Fill =
      level.orderId === undefined
        ? { priceE4: level.priceE4, quantity: take, source: level.source }
        : { priceE4: level.priceE4, quantity: take, source: level.source, orderId: level.orderId };
    fills.push(fill);
    valueCents += orderValueCents(take, level.priceE4);
    notionalE4 += take * level.priceE4;
    remaining -= take;
  }

  const filledQuantity = quantity - remaining;
  return {
    fills,
    filledQuantity,
    unfilledQuantity: remaining,
    valueCents,
    averagePriceE4: filledQuantity > ZERO ? divRoundHalfEven(notionalE4, filledQuantity) : ZERO,
  };
}

/** A resting limit order becomes executable against the market-maker quote. */
export function isLimitMarketable(side: "buy" | "sell", limitPriceE4: bigint, quote: Quote): boolean {
  return side === "buy" ? quote.askE4 <= limitPriceE4 : quote.bidE4 >= limitPriceE4;
}

/**
 * A stop order triggers on the last traded price and then executes as a market
 * order. `sell` stop = stop loss of a long position, `buy` stop = stop loss of a short.
 */
export function isStopTriggered(side: "buy" | "sell", stopPriceE4: bigint, lastPriceE4: bigint): boolean {
  return side === "sell" ? lastPriceE4 <= stopPriceE4 : lastPriceE4 >= stopPriceE4;
}
