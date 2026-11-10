import { describe, expect, it } from "vitest";
import { orderDraftSchema, orderValueCents } from "./order-schema";

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
