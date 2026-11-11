import { describe, expect, it } from "vitest";
import { formatMoneyShort } from "./format";

const nbsp = (s: string) => s.replace(/ /g, " ");

describe("formatMoneyShort (ADR-072)", () => {
  it("shows whole euros below 10.000 €", () => {
    expect(nbsp(formatMoneyShort(987_654))).toBe("9.876 €");
  });

  it("shows thousands as k and only switches when the next thousand is full", () => {
    expect(formatMoneyShort(1_500_000)).toBe("15k €");
    expect(formatMoneyShort(1_599_999)).toBe("15k €");
    expect(formatMoneyShort(1_599_900 + 99)).toBe("15k €");
    expect(formatMoneyShort(1_600_000)).toBe("16k €");
    expect(formatMoneyShort(99_999_999)).toBe("999k €");
  });

  it("uses Mio. and Mrd. with one decimal, rounded down", () => {
    expect(formatMoneyShort(100_000_000)).toBe("1 Mio. €");
    expect(formatMoneyShort(129_999_999)).toBe("1,2 Mio. €");
    expect(formatMoneyShort(250_000_000_000)).toBe("2,5 Mrd. €");
  });

  it("keeps the sign", () => {
    expect(formatMoneyShort(-2_000_000)).toBe("−20k €");
  });
});
