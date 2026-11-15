import { describe, expect, it } from "vitest";
import { BATTLE_RULES } from "../../../config/battles.ts";
import {
  auctionEval,
  auctionRanking,
  higherEval,
  higherHearts,
  higherRanking,
  higherSeries,
  pointsRanking,
  roundTimes,
  speedPoints,
  tickerEval,
  vaultEval,
  vaultFeedback,
  vaultPoints,
  vaultValid,
} from "./rounds-more.ts";

const g = BATTLE_RULES.games;

/** A small deterministic random source for the chart test. */
function lcg(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1_103_515_245 + 12_345) % 2_147_483_648;
    return x / 2_147_483_648;
  };
}

describe("round timing", () => {
  it("answer time, then the reveal; fast answers score more", () => {
    const t = roundTimes(1000, 2, g.ticker);
    expect(t.opens).toBe(1000 + 2 * (g.ticker.answerMs + g.ticker.revealMs));
    expect(t.ends - t.closes).toBe(g.ticker.revealMs);
    expect(speedPoints(0, 1000, 100, 100)).toBe(200);
    expect(speedPoints(500, 1000, 100, 100)).toBe(150);
    expect(speedPoints(5000, 1000, 100, 100)).toBe(100);
  });
});

describe("Tresorknacker", () => {
  it("says how many digits are in place and how many are elsewhere", () => {
    expect(vaultFeedback("352", "352")).toEqual({ hits: 3, near: 0 });
    expect(vaultFeedback("352", "325")).toEqual({ hits: 1, near: 2 });
    expect(vaultFeedback("352", "146")).toEqual({ hits: 0, near: 0 });
    expect(vaultFeedback("352", "523")).toEqual({ hits: 0, near: 3 });
  });

  it("takes only different digits 1..symbols of the right length", () => {
    expect(vaultValid("352", g.vault)).toBe(true);
    expect(vaultValid("355", g.vault)).toBe(false);
    expect(vaultValid("307", g.vault)).toBe(false);
    expect(vaultValid("3521", g.vault)).toBe(false);
    expect(vaultValid("3a2", g.vault)).toBe(false);
  });

  it("cracked fast with few tries scores most; only the first maxTries count", () => {
    const tries = [
      [
        { slot: 0, code: "123", ms: 2000 },
        { slot: 0, code: "352", ms: 6000 },
        { slot: 1, code: "352", ms: 1000 },
        ...Array.from({ length: g.vault.maxTries }, () => ({ slot: 2, code: "456", ms: 3000 })),
        { slot: 2, code: "352", ms: 9000 },
      ],
    ];
    const s = vaultEval(3, ["352"], tries, [-1, -1, -1], 1, { ...g.vault, rounds: 1 as never });
    expect(s.points).toEqual([vaultPoints(6000, 2, g.vault), vaultPoints(1000, 1, g.vault), 0]);
    expect(s.results[0]!.answers.map((a) => a.right)).toEqual([true, true, false]);
    expect(pointsRanking(1, s)[0]).toBe(1);
    expect(s.done).toBe(true);
  });
});

describe("Ticker-Tippen", () => {
  it("right is fast points, wrong costs points, none is nothing", () => {
    const s = tickerEval(
      3,
      [2],
      [
        [
          { slot: 0, choice: 2, ms: 1500 },
          { slot: 1, choice: 4, ms: 500 },
        ],
      ],
      [-1, -1, -1],
      1,
      { ...g.ticker, rounds: 1 as never },
    );
    expect(s.points).toEqual([
      speedPoints(1500, g.ticker.answerMs, g.ticker.basePoints, g.ticker.speedPoints),
      -g.ticker.wrongPoints,
      0,
    ]);
    expect(pointsRanking(1, s)).toEqual([0, 2, 1]);
  });
});

describe("Mehr oder Weniger", () => {
  it("wrong or none costs a heart, not when everyone is wrong; the last with hearts wins", () => {
    expect(higherHearts(4, g.higher)).toBe(g.higher.heartsSmall);
    expect(higherHearts(8, g.higher)).toBe(g.higher.heartsLarge);
    const params = { ...g.higher, heartsSmall: 1 as never };
    const s = higherEval(
      3,
      [0, 1],
      [
        [
          { slot: 0, choice: 1, ms: 100 },
          { slot: 1, choice: 1, ms: 100 },
          { slot: 2, choice: 1, ms: 100 },
        ],
        [
          { slot: 0, choice: 1, ms: 900 },
          { slot: 1, choice: 0, ms: 100 },
        ],
      ],
      [-1, -1, -1],
      2,
      params,
    );
    expect(s.results[0]!.lost).toEqual([]);
    expect(s.results[1]!.lost).toEqual([1, 2]);
    expect(s.out).toEqual([-1, 1, 1]);
    expect(s.done).toBe(true);
    expect(higherRanking(1, s)[0]).toBe(0);
  });

  it("the chart trends and never stays flat", () => {
    const series = higherSeries(400, g.higher, lcg(7));
    let same = 0;
    for (let i = 2; i < series.length; i++) {
      expect(series[i]).not.toBe(series[i - 1]);
      if (Math.sign(series[i]! - series[i - 1]!) === Math.sign(series[i - 1]! - series[i - 2]!)) same++;
    }
    expect(same / (series.length - 2)).toBeGreaterThan(0.55);
  });
});

describe("Wer bietet mehr?", () => {
  it("the highest bid wins the points and pays; a draw goes to the earlier bid; too high does not count", () => {
    const s = auctionEval(
      1,
      3,
      [300, 100],
      [
        [
          { slot: 0, value: 400, ms: 3000 },
          { slot: 1, value: 400, ms: 2000 },
          { slot: 2, value: 1200, ms: 100 },
        ],
        [
          { slot: 0, value: 50, ms: 1000 },
          { slot: 1, value: 700, ms: 1000 },
        ],
      ],
      [-1, -1, -1],
      2,
      { ...g.auction, rounds: 2 as never },
    );
    expect(s.points).toEqual([100, 300, 0]);
    expect(s.budget).toEqual([950, 600, 1000]);
    expect(s.results[0]!.answers.find((a) => a.right)!.slot).toBe(1);
    expect(s.results[1]!.answers.map((a) => a.slot)).toEqual([0]);
    expect(auctionRanking(1, s)).toEqual([1, 0, 2]);
  });

  it("nobody bids: nobody wins", () => {
    const s = auctionEval(1, 2, [100], [[{ slot: 0, value: 0, ms: 10 }]], [-1, -1], 1, g.auction);
    expect(s.points).toEqual([0, 0]);
  });
});
