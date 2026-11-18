import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  decideMultiBattle,
  multiBattleTimeline,
  multiKnownCards,
  multiRevealAt,
  multiShownCards,
  multiTwistAt,
  multiTwistsShown,
  twistCycles,
  twistPermutation,
  twistPermutations,
  twistPiles,
  twistScores,
  type BattlePull,
} from "./nexamon-battle.ts";

/*
 * Battle modes (ADR-205): "Umgekehrt" (the lowest total wins) and "Twist" (the piles are permuted after every pack).
 */
const pull = (rarity: BattlePull["rarity"], valueCents: number, pack = 1) => ({ rarity, valueCents, pack });
const cfg = BALANCE.nexamon;
const twistMs = cfg.packBattle.twistMs;

describe("reverse (Umgekehrt)", () => {
  it("the lowest total wins", () => {
    const d = decideMultiBattle([[pull("common", 100)], [pull("common", 300)], [pull("rare", 50)], []], 0, true);
    expect(d).toEqual({ winner: 3, tieBreak: "value", totals: [100, 300, 50, 0] });
  });

  it("ties are mirrored: the least rare top card, then the coin among those still tied", () => {
    const seats = [[pull("ultra", 500)], [pull("rare", 500)], [pull("legendary", 900)]];
    expect(decideMultiBattle(seats, 0, true)).toMatchObject({ winner: 1, tieBreak: "rarest" });
    const coin = [[pull("rare", 100)], [pull("rare", 900)], [pull("rare", 100)], [pull("rare", 100)]];
    expect(decideMultiBattle(coin, 0, true)).toMatchObject({ winner: 0, tieBreak: "coin" });
    expect(decideMultiBattle(coin, 1, true).winner).toBe(2);
    expect(decideMultiBattle(coin, 5, true).winner).toBe(3);
  });

  it("without reverse nothing changes", () => {
    const seats = [[pull("common", 100)], [pull("common", 300)]];
    expect(decideMultiBattle(seats, 3)).toEqual(decideMultiBattle(seats, 3, false));
    expect(decideMultiBattle(seats, 3).winner).toBe(1);
  });
});

describe("twist permutation", () => {
  // the same vectors run in supabase/tests/d7_battle_modes.sql against nexamon_battle_twist_perm
  it.each([
    [0, 1, 2, [0, 1]],
    [12345, 1, 4, [0, 1, 3, 2]],
    [12345, 2, 4, [3, 1, 2, 0]],
    [12345, 3, 4, [1, 3, 0, 2]],
    [2147483646, 7, 3, [1, 0, 2]],
    [987654321, 10, 4, [3, 0, 1, 2]],
    [42, 1, 3, [0, 2, 1]],
  ])("seed %i, round %i, %i seats", (seed, round, n, perm) => {
    expect(twistPermutation(seed, round, n)).toEqual(perm);
  });

  it("is a permutation, reproducible, and every order is about equally likely", () => {
    const counts = new Map<string, number>();
    for (let s = 0; s < 4800; s++) {
      const p = twistPermutation(s * 1_000_003 + 17, 3, 4);
      expect([...p].sort()).toEqual([0, 1, 2, 3]);
      counts.set(p.join(""), (counts.get(p.join("")) ?? 0) + 1);
    }
    expect(counts.size).toBe(24);
    for (const c of counts.values()) expect(c).toBeGreaterThan(120);
    expect(twistPermutations(77, 3, 3)).toEqual(twistPermutations(77, 3, 3));
    expect(twistPermutations(77, 3, 3)).toHaveLength(3);
  });

  it("two seats swap about half the time", () => {
    let swaps = 0;
    for (let s = 0; s < 2000; s++) if (twistPermutation(s * 7919 + 1, 1, 2)[0] === 1) swaps++;
    expect(swaps).toBeGreaterThan(850);
    expect(swaps).toBeLessThan(1150);
  });
});

describe("twist piles", () => {
  const seats = [
    [pull("common", 100, 1), pull("common", 10, 2)],
    [pull("rare", 200, 1), pull("common", 20, 2)],
    [pull("ultra", 300, 1), pull("common", 30, 2)],
  ];

  it("without twists every seat holds its own pulls", () => {
    expect(twistScores(seats, [], 2)).toEqual([110, 220, 330]);
  });

  it("after every pack the piles move: seat i takes the pile of perm[i]", () => {
    // after pack 1: 0 <- 2, 1 <- 0, 2 <- 1 => [300, 100, 200]; + pack 2 => [310, 120, 230]; then swap 0 and 1
    const twists = [
      [2, 0, 1],
      [1, 0, 2],
    ];
    expect(twistScores(seats, twists, 2)).toEqual([120, 310, 230]);
    // only the first twist so far (mid pack 2)
    expect(twistScores(seats, twists.slice(0, 1), 2)).toEqual([310, 120, 230]);
    const piles = twistPiles(seats, twists, 2);
    // the cards travel with the pile (for the rarity tie-break)
    expect(piles[1]!.map((c) => c.rarity)).toEqual(["ultra", "common"]);
  });

  it("twist and reverse combine: the lowest pile after the twists wins", () => {
    const twists = [
      [2, 0, 1],
      [1, 0, 2],
    ];
    const piles = twistPiles(seats, twists, 2);
    expect(decideMultiBattle(piles, 0, true)).toMatchObject({ winner: 0, totals: [120, 310, 230] });
    expect(decideMultiBattle(piles, 0, false)).toMatchObject({ winner: 1 });
  });

  it("reads as cycles in the direction the piles travel", () => {
    expect(twistCycles([1, 0, 2, 3])).toEqual([[0, 1]]);
    // seat 0 takes from 2, seat 1 from 0, seat 2 from 1: 0 -> 1 -> 2 -> 0
    expect(twistCycles([2, 0, 1])).toEqual([[0, 1, 2]]);
    expect(twistCycles([0, 1, 2])).toEqual([]);
    expect(twistCycles([1, 0, 3, 2])).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });
});

describe("twist timeline", () => {
  const s = 50_000;
  const b = cfg.battles;
  const size = cfg.packSize;

  it("without twistMs the clock is the multi clock", () => {
    expect(multiBattleTimeline(1_000, 3, cfg, 0)).toEqual(multiBattleTimeline(1_000, 3));
    expect(multiRevealAt(s, 7, cfg, 0)).toBe(multiRevealAt(s, 7));
  });

  it("a twist follows every pack one slot after its last card, then the next pack tears", () => {
    const lastOfPack1 = multiRevealAt(s, size - 1, cfg, twistMs);
    expect(multiTwistAt(s, 1, cfg, twistMs)).toBe(lastOfPack1 + b.slotMs);
    expect(multiRevealAt(s, size, cfg, twistMs)).toBe(multiTwistAt(s, 1, cfg, twistMs) + twistMs + b.tearMs);
    expect(multiTwistsShown(s, multiTwistAt(s, 1, cfg, twistMs) - 1, 3, cfg, twistMs)).toBe(0);
    expect(multiTwistsShown(s, multiTwistAt(s, 1, cfg, twistMs), 3, cfg, twistMs)).toBe(1);
    expect(multiTwistsShown(s, multiTwistAt(s, 1, cfg, twistMs) - b.leadMs, 3, cfg, twistMs, b.leadMs)).toBe(1);
    // nothing new shows while the twist plays
    expect(multiShownCards(s, multiTwistAt(s, 1, cfg, twistMs) + twistMs - 1, 3, cfg, twistMs)).toBe(size);
  });

  it("the last twist ends exactly at the decision", () => {
    const t = multiBattleTimeline(s - b.startDelayMs, 3, cfg, twistMs);
    expect(multiTwistAt(s, 3, cfg, twistMs) + twistMs).toBe(t.decideAt);
    expect(multiShownCards(s, t.decideAt, 3, cfg, twistMs)).toBe(3 * size);
    expect(multiKnownCards(s, t.decideAt, 3, cfg, twistMs)).toBe(3 * size);
    expect(multiTwistsShown(s, t.decideAt, 3, cfg, twistMs)).toBe(3);
  });
});
