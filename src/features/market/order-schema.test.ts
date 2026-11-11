import { describe, expect, it } from "vitest";
import {
  parseEuroCents,
  parsePriceE4,
  parseQuantityE6,
  quantityE6ForBudget,
  quantityE6ForProceeds,
  valueCents,
} from "./order-schema";

describe("valueCents", () => {
  it("converts e6 shares × e4 price to cents", () => {
    expect(valueCents(10_000_000, 1_126_400)).toBe(112_640); // 10 × 112,64 €
    expect(valueCents(1_000_000, 7_420)).toBe(74); // 1 × 0,742 €
    expect(valueCents(443_900, 1_126_400)).toBe(5_000); // 0,4439 × 112,64 € = 50,00 €
  });

  it("rounds half to even, like the server", () => {
    expect(valueCents(500_000, 100)).toBe(0); // 0.5 cent -> 0
    expect(valueCents(1_500_000, 100)).toBe(2); // 1.5 cent -> 2
    expect(valueCents(2_500_000, 100)).toBe(2); // 2.5 cent -> 2
  });

  it("stays exact for big orders beyond 2^53", () => {
    expect(valueCents(100_000 * 1_000_000, 23_140_000)).toBe(231_400_000_00);
  });
});

describe("amount orders", () => {
  it("invests exactly the budget minus the fee in fractions", () => {
    // 50 € budget, 1 € fee, 112,64 € per share -> 0,435014 shares worth 49,00 €
    const q = quantityE6ForBudget(5_000, 1_126_400, 100);
    expect(q).toBe(435_014);
    expect(valueCents(q, 1_126_400)).toBe(4_900);
    expect(quantityE6ForBudget(100, 1_126_400, 100)).toBe(0);
  });

  it("sells enough fractions to raise at least the amount", () => {
    const q = quantityE6ForProceeds(5_000, 1_126_400);
    expect(valueCents(q, 1_126_400)).toBeGreaterThanOrEqual(5_000);
    expect(valueCents(q - 1, 1_126_400)).toBeLessThanOrEqual(5_000);
  });
});

describe("parsing", () => {
  it("parses German euro amounts", () => {
    expect(parseEuroCents("1.234,56")).toBe(123_456);
    expect(parseEuroCents("50")).toBe(5_000);
    expect(parseEuroCents("12,5 €")).toBe(1_250);
    expect(parseEuroCents("abc")).toBeNull();
    expect(parseEuroCents("1,234")).toBeNull();
  });
  it("parses prices with four decimals", () => {
    expect(parsePriceE4("0,7420")).toBe(7_420);
    expect(parsePriceE4("112,64")).toBe(1_126_400);
    expect(parsePriceE4("0")).toBeNull();
  });
  it("parses fractional quantities", () => {
    expect(parseQuantityE6("2")).toBe(2_000_000);
    expect(parseQuantityE6("0,5")).toBe(500_000);
    expect(parseQuantityE6("1,234567")).toBe(1_234_567);
    expect(parseQuantityE6("1,2345678")).toBeNull();
    expect(parseQuantityE6("0")).toBeNull();
  });
});
