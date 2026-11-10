import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  adjustDivisor,
  freeFloatMarketCapCents,
  indexLevel,
  indexWeights,
  initialDivisor,
  reviewIndexMembership,
  totalFreeFloatCapCents,
} from "./nexa-index.ts";
import type { IndexCandidate } from "./types.ts";

const b = (n: number) => BigInt(n);
const stock = (price: number, shares: number) => ({ priceE4: b(price), freeFloatShares: b(shares) });

describe("NEXA 30 level", () => {
  const basket = [stock(1_000_000, 1_000_000), stock(500_000, 4_000_000), stock(20_000, 10_000_000)];

  it("computes free-float market caps", () => {
    expect(freeFloatMarketCapCents(stock(1_000_000, 1_000_000))).toBe(b(10_000_000_000));
    expect(totalFreeFloatCapCents(basket)).toBe(b(10_000_000_000 + 20_000_000_000 + 2_000_000_000));
  });

  it("starts at the base level", () => {
    const divisor = initialDivisor(basket);
    expect(indexLevel(basket, divisor)).toBeCloseTo(BALANCE.index.baseLevel, 9);
  });

  it("weights by free-float market cap", () => {
    const weights = indexWeights(basket);
    expect(weights.reduce((a, w) => a + w, 0)).toBeCloseTo(1, 12);
    expect(weights[1]).toBeCloseTo(20 / 32, 12);
  });

  it("moves with prices in proportion to the weight", () => {
    const divisor = initialDivisor(basket);
    const moved = [stock(1_000_000, 1_000_000), stock(550_000, 4_000_000), stock(20_000, 10_000_000)];
    expect(indexLevel(moved, divisor)).toBeCloseTo(1000 * (1 + 0.1 * (20 / 32)), 6);
  });

  it("stays continuous when the basket changes", () => {
    const divisor = initialDivisor(basket);
    const before = indexLevel(basket, divisor);
    const extended = [...basket, stock(300_000, 2_000_000)];
    const newDivisor = adjustDivisor(divisor, totalFreeFloatCapCents(basket), totalFreeFloatCapCents(extended));
    expect(indexLevel(extended, newDivisor)).toBeCloseTo(before, 6);
  });

  it("rejects degenerate input", () => {
    expect(() => initialDivisor([])).toThrow(RangeError);
    expect(() => indexLevel(basket, 0)).toThrow(RangeError);
    expect(() => adjustDivisor(1, b(0), b(1))).toThrow(RangeError);
  });
});

describe("membership review", () => {
  const cfg = { ...BALANCE.index, size: 4, entryBuffer: 1 };
  const candidate = (id: string, cap: number, isMember: boolean, listedQuarters = 8): IndexCandidate => ({
    securityId: id,
    priceE4: b(10_000),
    freeFloatShares: b(cap),
    listedQuarters,
    isMember,
  });

  it("takes everyone while there are fewer companies than seats", () => {
    const review = reviewIndexMembership([candidate("a", 5, true), candidate("b", 3, false)], cfg);
    expect(review.members).toEqual(["a", "b"]);
    expect(review.added).toEqual(["b"]);
    expect(review.removed).toEqual([]);
  });

  it("with all 15 AI companies and the real config every listed company is a member", () => {
    const all = Array.from({ length: 15 }, (_, i) => candidate(`c${i}`, 100 - i, true));
    const review = reviewIndexMembership([...all, candidate("player", 1, false)]);
    expect(review.members).toHaveLength(16);
    expect(review.added).toEqual(["player"]);
  });

  it("excludes fresh listings until the minimum listing age", () => {
    const review = reviewIndexMembership([candidate("a", 5, true), candidate("ipo", 50, false, 0)], cfg);
    expect(review.members).toEqual(["a"]);
  });

  it("replaces a member only when the newcomer clearly outranks it (buffer)", () => {
    const members = [
      candidate("a", 100, true),
      candidate("b", 90, true),
      candidate("c", 80, true),
      candidate("d", 70, true),
    ];
    // Rank 4 is not enough: the newcomer must reach rank 3 (size - buffer).
    const close = reviewIndexMembership([...members, candidate("new", 75, false)], cfg);
    expect(close.members).toEqual(["a", "b", "c", "d"]);
    expect(close.added).toEqual([]);

    const clear = reviewIndexMembership([...members, candidate("new", 85, false)], cfg);
    expect(clear.members).toEqual(["a", "b", "new", "c"]);
    expect(clear.added).toEqual(["new"]);
    expect(clear.removed).toEqual(["d"]);
  });

  it("drops a member that fell far behind", () => {
    const review = reviewIndexMembership(
      [
        candidate("a", 100, true),
        candidate("b", 90, true),
        candidate("c", 80, true),
        candidate("fallen", 1, true),
        candidate("x", 60, false),
        candidate("y", 50, false),
      ],
      cfg,
    );
    expect(review.members).toEqual(["a", "b", "c", "x"]);
    expect(review.removed).toEqual(["fallen"]);
  });

  it("always returns exactly `size` members when enough are eligible", () => {
    const many = Array.from({ length: 40 }, (_, i) => candidate(`c${i}`, 1000 - i * 7, i % 3 === 0));
    const review = reviewIndexMembership(many);
    expect(review.members).toHaveLength(BALANCE.index.size);
    expect(new Set(review.members).size).toBe(BALANCE.index.size);
  });
});
