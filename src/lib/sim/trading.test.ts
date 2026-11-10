import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { halfSpreadBps, quoteAround, synthesizeOrderBook } from "./market-maker.ts";
import { isLimitMarketable, isStopTriggered, mergeOrderBook, walkBook } from "./orders.ts";
import { depthShares, estimateMarketOrder, impactReturn, maxFillableShares } from "./price-impact.ts";
import { createRng } from "./rng.ts";
import type { OrderBookLevel } from "./types.ts";

const b = (n: number) => BigInt(n);

describe("depth and impact", () => {
  it("depth is a fraction of the free float, thinner after hours", () => {
    expect(depthShares(b(1_000_000), "open")).toBe(2_000);
    expect(depthShares(b(1_000_000), "after_hours")).toBe(500);
    expect(depthShares(b(0), "open")).toBe(1);
  });

  it("one depth moves the price by 1 %", () => {
    expect(impactReturn(2_000, 2_000)).toBeCloseTo(0.01, 12);
    expect(impactReturn(-2_000, 2_000)).toBeCloseTo(-0.01, 12);
    expect(impactReturn(0, 2_000)).toBe(0);
  });

  it("is split-invariant (linear)", () => {
    const whole = impactReturn(900, 2_000);
    const pieces = impactReturn(300, 2_000) * 3;
    expect(pieces).toBeCloseTo(whole, 12);
  });

  it("the same order moves the price more after hours", () => {
    const open = impactReturn(100, depthShares(b(1_000_000), "open"));
    const late = impactReturn(100, depthShares(b(1_000_000), "after_hours"));
    expect(late).toBeCloseTo(open * 4, 12);
  });
});

describe("spread and quotes", () => {
  it("orders the size classes and widens after hours and with sentiment", () => {
    const blue = halfSpreadBps("bluechip", "open");
    const penny = halfSpreadBps("penny", "open");
    expect(penny).toBeGreaterThan(blue);
    expect(halfSpreadBps("bluechip", "after_hours")).toBe(blue * BALANCE.time.afterHours.spreadMultiplier);
    expect(halfSpreadBps("bluechip", "open", -0.8)).toBeGreaterThan(blue);
  });

  it("quotes symmetric around the mid", () => {
    const q = quoteAround(b(1_000_000), 5);
    expect(q.bidE4).toBe(b(999_500));
    expect(q.askE4).toBe(b(1_000_500));
  });

  it("keeps at least one price unit on each side and bid >= 1", () => {
    const q = quoteAround(b(2), 5);
    expect(q.bidE4).toBe(b(1));
    expect(q.askE4).toBe(b(3));
    const tiny = quoteAround(b(1), 5);
    expect(tiny.bidE4).toBe(b(1));
    expect(tiny.askE4).toBe(b(2));
    const zero = quoteAround(b(0), 5);
    expect(zero.bidE4 >= b(1)).toBe(true);
    expect(zero.askE4 > zero.bidE4).toBe(true);
  });
});

describe("synthetic order book", () => {
  const quote = quoteAround(b(1_000_000), 5);

  it("builds monotone levels on both sides", () => {
    const book = synthesizeOrderBook(quote, 2_000, createRng(1));
    expect(book.bids).toHaveLength(BALANCE.trading.orderBook.levelsPerSide);
    expect(book.asks).toHaveLength(BALANCE.trading.orderBook.levelsPerSide);
    expect(book.bids[0]?.priceE4).toBe(quote.bidE4);
    expect(book.asks[0]?.priceE4).toBe(quote.askE4);
    for (let i = 1; i < book.bids.length; i++) {
      expect((book.bids[i] as OrderBookLevel).priceE4 < (book.bids[i - 1] as OrderBookLevel).priceE4).toBe(true);
      expect((book.asks[i] as OrderBookLevel).priceE4 > (book.asks[i - 1] as OrderBookLevel).priceE4).toBe(true);
    }
    for (const level of [...book.bids, ...book.asks]) expect(level.quantity > b(0)).toBe(true);
  });

  it("is deterministic for the same stream", () => {
    expect(synthesizeOrderBook(quote, 2_000, createRng(5))).toEqual(synthesizeOrderBook(quote, 2_000, createRng(5)));
  });

  it("offers depth x step / impact shares per level without jitter", () => {
    const book = synthesizeOrderBook(quote, 2_000, null);
    for (const level of book.asks) expect(level.quantity).toBe(b(200));
  });

  it("never quotes below the minimum price for penny stocks", () => {
    const book = synthesizeOrderBook(quoteAround(b(3), 60), 2_000, null);
    for (const level of book.bids) expect(level.priceE4 >= b(1)).toBe(true);
    expect(book.bids.length).toBeLessThanOrEqual(2);
    expect(book.asks).toHaveLength(BALANCE.trading.orderBook.levelsPerSide);
  });

  it("walking the book matches the closed-form slippage estimate", () => {
    const depth = 2_000;
    const book = synthesizeOrderBook(quote, depth, null);
    const quantity = b(1_000); // half a depth: 0.5 % full impact, 0.25 % average
    const walked = walkBook("buy", quantity, book.asks);
    const estimate = estimateMarketOrder("buy", quantity, quote, depth);
    expect(walked.filledQuantity).toBe(quantity);
    const relative = Number(walked.averagePriceE4) / Number(estimate.averagePriceE4) - 1;
    // The step book is a discretisation of the linear model (half a level step of error).
    expect(Math.abs(relative)).toBeLessThan(0.0006);
    expect(estimate.slippageBps).toBeCloseTo(25, 6);
  });
});

describe("estimateMarketOrder", () => {
  const quote = quoteAround(b(1_000_000), 5);

  it("buys above the ask and sells below the bid", () => {
    const buy = estimateMarketOrder("buy", b(500), quote, 2_000);
    const sell = estimateMarketOrder("sell", b(500), quote, 2_000);
    expect(buy.averagePriceE4 > quote.askE4).toBe(true);
    expect(buy.worstPriceE4 > buy.averagePriceE4).toBe(true);
    expect(sell.averagePriceE4 < quote.bidE4).toBe(true);
    expect(buy.immediateMidReturn).toBeGreaterThan(0);
    expect(sell.immediateMidReturn).toBeLessThan(0);
  });

  it("slippage grows with size and is tiny for small orders", () => {
    const small = estimateMarketOrder("buy", b(1), quote, 2_000);
    const large = estimateMarketOrder("buy", b(1_500), quote, 2_000);
    expect(small.slippageBps).toBeLessThan(0.1);
    expect(large.slippageBps).toBeGreaterThan(small.slippageBps);
  });

  it("only partially fills orders beyond the impact cap", () => {
    const max = maxFillableShares(2_000);
    expect(max).toBe(b(30_000)); // 15 % cap / 1 % per depth x 2000
    const huge = estimateMarketOrder("buy", b(50_000), quote, 2_000);
    expect(huge.filledQuantity).toBe(max);
    expect(huge.unfilledQuantity).toBe(b(20_000));
  });

  it("rejects non-positive quantities", () => {
    expect(() => estimateMarketOrder("buy", b(0), quote, 2_000)).toThrow(RangeError);
  });
});

describe("order matching", () => {
  const synthetic = synthesizeOrderBook(quoteAround(b(1_000_000), 5), 2_000, null);

  it("puts better-priced player orders in front and players first at equal price", () => {
    const players: OrderBookLevel[] = [
      { side: "ask", priceE4: b(1_000_200), quantity: b(50), source: "player", orderId: "o1" },
      { side: "ask", priceE4: b(1_000_500), quantity: b(10), source: "player", orderId: "o2" },
      { side: "bid", priceE4: b(999_900), quantity: b(5), source: "player", orderId: "o3" },
    ];
    const book = mergeOrderBook(synthetic, players);
    expect(book.asks[0]?.orderId).toBe("o1");
    expect(book.asks[1]?.orderId).toBe("o2");
    expect(book.asks[2]?.source).toBe("market_maker");
    expect(book.bids[0]?.orderId).toBe("o3");
    for (let i = 1; i < book.asks.length; i++) {
      expect((book.asks[i] as OrderBookLevel).priceE4 >= (book.asks[i - 1] as OrderBookLevel).priceE4).toBe(true);
    }
  });

  it("fills level by level and values each fill", () => {
    const asks: OrderBookLevel[] = [
      { side: "ask", priceE4: b(100_000), quantity: b(10), source: "player", orderId: "a" },
      { side: "ask", priceE4: b(110_000), quantity: b(10), source: "market_maker" },
    ];
    const result = walkBook("buy", b(15), asks);
    expect(result.fills).toEqual([
      { priceE4: b(100_000), quantity: b(10), source: "player", orderId: "a" },
      { priceE4: b(110_000), quantity: b(5), source: "market_maker" },
    ]);
    expect(result.valueCents).toBe(b(10_000 + 5_500));
    expect(result.averagePriceE4).toBe(b(103_333));
    expect(result.unfilledQuantity).toBe(b(0));
  });

  it("respects the limit price and reports the rest", () => {
    const asks: OrderBookLevel[] = [
      { side: "ask", priceE4: b(100_000), quantity: b(10), source: "market_maker" },
      { side: "ask", priceE4: b(110_000), quantity: b(10), source: "market_maker" },
    ];
    const result = walkBook("buy", b(15), asks, b(105_000));
    expect(result.filledQuantity).toBe(b(10));
    expect(result.unfilledQuantity).toBe(b(5));
    const none = walkBook(
      "sell",
      b(5),
      [{ side: "bid", priceE4: b(90), quantity: b(5), source: "market_maker" }],
      b(95),
    );
    expect(none.filledQuantity).toBe(b(0));
    expect(none.averagePriceE4).toBe(b(0));
  });

  it("detects marketable limits and triggered stops", () => {
    const quote = quoteAround(b(1_000_000), 5);
    expect(isLimitMarketable("buy", b(1_000_500), quote)).toBe(true);
    expect(isLimitMarketable("buy", b(1_000_499), quote)).toBe(false);
    expect(isLimitMarketable("sell", b(999_500), quote)).toBe(true);
    expect(isLimitMarketable("sell", b(999_501), quote)).toBe(false);
    expect(isStopTriggered("sell", b(950_000), b(949_999))).toBe(true);
    expect(isStopTriggered("sell", b(950_000), b(950_001))).toBe(false);
    expect(isStopTriggered("buy", b(1_050_000), b(1_050_000))).toBe(true);
  });
});
