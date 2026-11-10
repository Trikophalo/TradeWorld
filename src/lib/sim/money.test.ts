import { describe, expect, it } from "vitest";
import {
  applyBps,
  centsFromEuros,
  divCeil,
  divFloor,
  divRoundHalfEven,
  orderValueCents,
  priceE4FromEuros,
  ratioBps,
  roundToBigInt,
  scaleByFloat,
  toBigInt,
  toSafeNumber,
} from "./money.ts";

const b = (n: number) => BigInt(n);

describe("divRoundHalfEven", () => {
  it("rounds ties to the even neighbour", () => {
    expect(divRoundHalfEven(b(5), b(10))).toBe(b(0));
    expect(divRoundHalfEven(b(15), b(10))).toBe(b(2));
    expect(divRoundHalfEven(b(25), b(10))).toBe(b(2));
    expect(divRoundHalfEven(b(35), b(10))).toBe(b(4));
  });

  it("rounds non-ties to the nearest", () => {
    expect(divRoundHalfEven(b(14), b(10))).toBe(b(1));
    expect(divRoundHalfEven(b(16), b(10))).toBe(b(2));
  });

  it("is symmetric for negative values", () => {
    expect(divRoundHalfEven(b(-15), b(10))).toBe(b(-2));
    expect(divRoundHalfEven(b(-25), b(10))).toBe(b(-2));
    expect(divRoundHalfEven(b(25), b(-10))).toBe(b(-2));
    expect(divRoundHalfEven(b(-16), b(10))).toBe(b(-2));
  });

  it("rejects division by zero", () => {
    expect(() => divRoundHalfEven(b(1), b(0))).toThrow(RangeError);
  });
});

describe("divFloor / divCeil", () => {
  it("round towards the infinities", () => {
    expect(divFloor(b(7), b(2))).toBe(b(3));
    expect(divFloor(b(-7), b(2))).toBe(b(-4));
    expect(divCeil(b(7), b(2))).toBe(b(4));
    expect(divCeil(b(-7), b(2))).toBe(b(-3));
    expect(divFloor(b(6), b(2))).toBe(b(3));
    expect(divCeil(b(6), b(2))).toBe(b(3));
  });
});

describe("orderValueCents", () => {
  it("converts quantity x price to cents", () => {
    // 10 shares at 12.3456 EUR = 123.456 EUR -> 12346 cents
    expect(orderValueCents(b(10), b(123_456))).toBe(b(12_346));
    // 3 shares at 0.2001 EUR = 0.6003 EUR -> 60 cents
    expect(orderValueCents(b(3), b(2_001))).toBe(b(60));
  });

  it("rounds exact halves to even", () => {
    // 1 share at 0.0050 EUR = 0.5 cents -> 0; at 0.0150 EUR = 1.5 cents -> 2
    expect(orderValueCents(b(1), b(50))).toBe(b(0));
    expect(orderValueCents(b(1), b(150))).toBe(b(2));
    expect(orderValueCents(b(1), b(250))).toBe(b(2));
  });

  it("stays exact for huge orders", () => {
    const quantity = BigInt("9000000000000");
    const price = BigInt("12345678");
    expect(orderValueCents(quantity, price)).toBe(BigInt("1111111020000000000"));
  });
});

describe("bps helpers", () => {
  it("applies basis points with half-even rounding", () => {
    expect(applyBps(b(10_000), 2500)).toBe(b(2_500));
    expect(applyBps(b(1), 5000)).toBe(b(0));
    expect(applyBps(b(3), 5000)).toBe(b(2));
    expect(applyBps(b(-10_000), 2500)).toBe(b(-2_500));
    expect(applyBps(b(999), b(1))).toBe(b(0));
  });

  it("computes ratios in bps", () => {
    expect(ratioBps(b(1), b(4))).toBe(2500);
    expect(ratioBps(b(1), b(0))).toBe(0);
  });
});

describe("conversions", () => {
  it("guards the number <-> bigint boundary", () => {
    expect(toBigInt(42)).toBe(b(42));
    expect(() => toBigInt(0.5)).toThrow(RangeError);
    expect(() => toBigInt(2 ** 60)).toThrow(RangeError);
    expect(toSafeNumber(b(42))).toBe(42);
    expect(() => toSafeNumber(BigInt("9007199254740993"))).toThrow(RangeError);
  });

  it("rounds model values", () => {
    expect(roundToBigInt(1.4)).toBe(b(1));
    expect(roundToBigInt(1.6)).toBe(b(2));
    expect(() => roundToBigInt(Number.NaN)).toThrow(RangeError);
    expect(centsFromEuros(12.34)).toBe(b(1234));
    expect(priceE4FromEuros(0.2001)).toBe(b(2001));
  });

  it("scales bigint amounts by a float factor", () => {
    expect(scaleByFloat(b(1_000_000), 0.25)).toBe(b(250_000));
    expect(scaleByFloat(BigInt("300000000000000000000"), 0.5)).toBe(BigInt("150000000000000000000"));
    expect(scaleByFloat(b(100), 1 / 3)).toBe(b(33));
  });
});
