import { describe, expect, it } from "vitest";
import {
  orderDraftSchema,
  orderValueCents,
  parseEuroCents,
  parsePriceE4,
  quantityForBudget,
  quantityForProceeds,
} from "./order-schema";

describe("orderValueCents", () => {
  it("converts quantity × price (scaled by 10_000) to cents", () => {
    expect(orderValueCents(10, 1_126_400)).toBe(112_640);
    expect(orderValueCents(1, 7_420)).toBe(74);
  });

  it("rounds half to even, like the server", () => {
    expect(orderValueCents(1, 50)).toBe(0); // 0.5 cent -> 0
    expect(orderValueCents(3, 50)).toBe(2); // 1.5 cent -> 2
    expect(orderValueCents(5, 50)).toBe(2); // 2.5 cent -> 2
  });
});

describe("orderDraftSchema", () => {
  const base = {
    requestId: "7f0c2f6e-58c1-4b1e-9d0a-0c5d2f3a4b6c",
    ticker: "VLT",
    side: "buy",
    type: "market",
    quantity: 1,
  };
  it("accepts a plain market order", () => {
    expect(orderDraftSchema.safeParse(base).success).toBe(true);
  });
  it.each([0, -1, 1.5, 100_001])("rejects quantity %s", (quantity) => {
    expect(orderDraftSchema.safeParse({ ...base, quantity }).success).toBe(false);
  });
});

describe("euro input", () => {
  it("parses German amounts", () => {
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
});

describe("budget to shares", () => {
  it("buys as many whole shares as fit after the fee", () => {
    // 500 € budget, 112,64 € per share, 1 € fee -> 4 shares (451,56 €)
    expect(quantityForBudget(50_000, 1_126_400, 100)).toBe(4);
    expect(quantityForBudget(11_364, 1_126_400, 100)).toBe(1); // exactly price + fee
    expect(quantityForBudget(11_363, 1_126_400, 100)).toBe(0);
  });
  it("sells enough shares to raise at least the amount", () => {
    expect(quantityForProceeds(50_000, 1_126_400)).toBe(5);
  });
});
