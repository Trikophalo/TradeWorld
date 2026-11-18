import { describe, expect, it } from "vitest";
import { aiHireOptions, SEAT_ROWS_MAX, visibleRows } from "./seats";

describe("seats (ADR-218)", () => {
  it("offers 1–3 AI workers for small companies, as before", () => {
    expect(aiHireOptions(0)).toEqual([]);
    expect(aiHireOptions(1)).toEqual([1]);
    expect(aiHireOptions(3)).toEqual([1, 2, 3]);
  });

  it("offers bigger steps up to every free seat, at most five choices", () => {
    expect(aiHireOptions(4)).toEqual([1, 4]);
    expect(aiHireOptions(12)).toEqual([1, 5, 10, 12]);
    expect(aiHireOptions(999)).toEqual([1, 50, 100, 250, 999]);
    const big = aiHireOptions(999);
    expect(big.length).toBeLessThanOrEqual(5);
    expect(big[0]).toBe(1);
    expect(big.at(-1)).toBe(999);
    expect([...big].sort((a, b) => a - b)).toEqual(big);
    expect(new Set(big).size).toBe(big.length);
  });

  it("draws at most SEAT_ROWS_MAX rows and sums up the rest", () => {
    expect(visibleRows(5)).toEqual({ shown: 5, more: 0 });
    expect(visibleRows(1000)).toEqual({ shown: SEAT_ROWS_MAX, more: 1000 - SEAT_ROWS_MAX });
  });
});
