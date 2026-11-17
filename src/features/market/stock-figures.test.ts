import { describe, expect, it } from "vitest";
import { revenueTrend } from "./stock-figures";

describe("revenueTrend", () => {
  it("compares with the previous period", () => {
    expect(revenueTrend({ revenueCents: 2_000, prevRevenueCents: 1_000 })).toBe("up");
    expect(revenueTrend({ revenueCents: 500, prevRevenueCents: 1_000 })).toBe("down");
    expect(revenueTrend({ revenueCents: 1_000, prevRevenueCents: 1_000 })).toBe("flat");
  });

  it("has no arrow without a previous period", () => {
    expect(revenueTrend({ revenueCents: 1_000, prevRevenueCents: null })).toBeNull();
  });
});
