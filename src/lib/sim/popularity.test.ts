import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { comparePopularity, popularityScore, viewCounts } from "./popularity.ts";

const cfg = BALANCE.marketPopularity;

describe("popularityScore", () => {
  it("adds views, investors and the square root of the bought euros", () => {
    expect(popularityScore(0, 0, 0)).toBe(0);
    expect(popularityScore(5, 0, 0)).toBe(5 * cfg.weights.view);
    expect(popularityScore(0, 2, 0)).toBe(2 * cfg.weights.investor);
    // 10.000 € bought: √10.000 = 100
    expect(popularityScore(0, 0, 1_000_000)).toBe(Math.floor(100 * cfg.weights.volume));
    expect(popularityScore(3, 1, 1_000_000)).toBe(
      3 * cfg.weights.view + cfg.weights.investor + Math.floor(100 * cfg.weights.volume),
    );
  });

  it("ignores cents below a euro and negative input", () => {
    expect(popularityScore(-1, -1, 99)).toBe(0);
  });

  it("many small investors beat one big one with the same money", () => {
    expect(popularityScore(0, 4, 400_000)).toBeGreaterThan(popularityScore(0, 1, 400_000));
  });
});

describe("viewCounts", () => {
  it("counts the first view and again after the pause", () => {
    const pause = cfg.viewCooldownMinutes * 60_000;
    expect(viewCounts(null, 0)).toBe(true);
    expect(viewCounts(1_000, 1_000 + pause - 1)).toBe(false);
    expect(viewCounts(1_000, 1_000 + pause)).toBe(true);
  });
});

describe("comparePopularity", () => {
  it("orders by score, then market value, then name", () => {
    const rows = [
      { ticker: "B", name: "Beta", popularity: 0, marketCapCents: 100 },
      { ticker: "A", name: "Alpha", popularity: 0, marketCapCents: 100 },
      { ticker: "C", name: "Gamma", popularity: 5, marketCapCents: 1 },
      { ticker: "D", name: "Delta", popularity: 0, marketCapCents: 900 },
    ];
    expect([...rows].sort(comparePopularity).map((r) => r.ticker)).toEqual(["C", "D", "A", "B"]);
  });
});
