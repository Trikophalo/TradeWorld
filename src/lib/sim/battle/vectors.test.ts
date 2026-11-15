import { describe, expect, it } from "vitest";
import { TICK_KINDS, type TickKind } from "../../../config/battles.ts";
import { battleHash } from "./hash.ts";
import { battleRanking, defaultSimParams, simulateBattle } from "./index.ts";
import { botStream } from "./vectors.ts";

/*
 * Golden vectors (ADR-160): the same bot inputs give the same result here and in SQL
 * (supabase/tests/9s_battles.sql runs public.battle_sim on identical inputs and expects these numbers).
 * After a change of the rules or of the balance, regenerate both lists from the TypeScript simulation.
 */
type Vector = [TickKind, number, number, number, { end: number; ranking: number[]; out: number[]; score: number[] }];

const VECTORS: Vector[] = [
  ["floor", 42, 3, -1, { end: 198, ranking: [1, 2, 0], out: [148, -1, 198], score: [30, 36, 28] }],
  [
    "floor",
    7,
    6,
    -1,
    { end: 198, ranking: [4, 0, 1, 5, 3, 2], out: [198, 188, 144, 144, -1, 160], score: [39, 36, 25, 34, 36, 27] },
  ],
  [
    "floor",
    99,
    10,
    -1,
    {
      end: 264,
      ranking: [8, 0, 1, 7, 9, 5, 4, 6, 3, 2],
      out: [264, 258, 122, 138, 188, 196, 182, 222, -1, 200],
      score: [44, 34, 22, 27, 35, 26, 32, 39, 42, 39],
    },
  ],
  ["floor", 2026, 4, 100, { end: 204, ranking: [0, 2, 1, 3], out: [-1, 196, 204, 171], score: [38, 34, 37, 18] }],
  ["bulls", 42, 3, -1, { end: 498, ranking: [2, 0, 1], out: [498, 430, -1], score: [0, 0, 1] }],
  [
    "bulls",
    7,
    6,
    -1,
    { end: 626, ranking: [1, 0, 2, 3, 5, 4], out: [626, -1, 618, 588, 538, 564], score: [0, 1, 0, 0, 0, 0] },
  ],
  [
    "bulls",
    99,
    10,
    -1,
    {
      end: 648,
      ranking: [3, 2, 1, 9, 8, 7, 0, 6, 5, 4],
      out: [590, 644, 648, -1, 362, 432, 527, 592, 596, 638],
      score: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    },
  ],
  ["bulls", 2026, 4, 100, { end: 496, ranking: [1, 2, 0, 3], out: [490, -1, 496, 179], score: [0, 3, 0, 3] }],
  ["coins", 42, 3, -1, { end: 899, ranking: [2, 0, 1], out: [-1, -1, -1], score: [15, 9, 17] }],
  [
    "coins",
    7,
    6,
    -1,
    { end: 899, ranking: [2, 4, 0, 3, 1, 5], out: [-1, -1, -1, -1, -1, -1], score: [19, 14, 23, 14, 21, 14] },
  ],
  [
    "coins",
    99,
    10,
    -1,
    {
      end: 899,
      ranking: [7, 0, 4, 8, 2, 6, 5, 9, 1, 3],
      out: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
      score: [25, 14, 21, 12, 25, 16, 17, 32, 24, 15],
    },
  ],
  ["coins", 2026, 4, 100, { end: 899, ranking: [0, 2, 1, 3], out: [-1, -1, -1, 179], score: [27, 13, 26, 0] }],
  ["sumo", 42, 3, -1, { end: 520, ranking: [0, 2, 1], out: [520, 520, 520], score: [1, 0, 1] }],
  [
    "sumo",
    7,
    6,
    -1,
    { end: 740, ranking: [1, 4, 5, 3, 2, 0], out: [233, -1, 520, 520, 740, 622], score: [1, 6, 3, 3, 1, 3] },
  ],
  [
    "sumo",
    99,
    10,
    -1,
    {
      end: 796,
      ranking: [0, 1, 4, 7, 3, 9, 2, 8, 5, 6],
      out: [-1, 796, 190, 478, 520, 107, 76, 520, 178, 281],
      score: [8, 7, 1, 10, 7, 0, 0, 2, 3, 4],
    },
  ],
  ["sumo", 2026, 4, 100, { end: 520, ranking: [2, 0, 1, 3], out: [520, 224, -1, 179], score: [2, 1, 1, 2] }],
  ["potato", 42, 3, -1, { end: 480, ranking: [0, 1, 2], out: [-1, 480, 240], score: [182, 19, 201] }],
  [
    "potato",
    7,
    6,
    -1,
    { end: 1060, ranking: [5, 0, 4, 3, 1, 2], out: [1060, 400, 220, 620, 840, -1], score: [304, 181, 8, 181, 181, 10] },
  ],
  [
    "potato",
    99,
    10,
    -1,
    {
      end: 1480,
      ranking: [0, 2, 7, 5, 3, 1, 9, 8, 6, 4],
      out: [-1, 860, 1480, 1020, 180, 1140, 360, 1300, 520, 680],
      score: [79, 48, 284, 52, 31, 295, 59, 158, 79, 44],
    },
  ],
  ["potato", 2026, 4, 100, { end: 480, ranking: [0, 2, 1, 3], out: [-1, 260, 480, 179], score: [0, 81, 321, 0] }],
  ["pump", 42, 3, -1, { end: 599, ranking: [1, 0, 2], out: [-1, -1, -1], score: [84, 84, 82] }],
  [
    "pump",
    7,
    6,
    -1,
    { end: 599, ranking: [0, 3, 1, 4, 2, 5], out: [-1, -1, -1, -1, -1, -1], score: [109, 103, 96, 103, 97, 95] },
  ],
  [
    "pump",
    99,
    10,
    -1,
    {
      end: 599,
      ranking: [2, 4, 8, 6, 3, 9, 1, 0, 5, 7],
      out: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
      score: [126, 130, 147, 136, 145, 125, 141, 125, 145, 132],
    },
  ],
  ["pump", 2026, 4, 100, { end: 599, ranking: [2, 0, 1, 3], out: [-1, -1, -1, 179], score: [58, 53, 62, 27] }],
  // the games of the addendum to ADR-160 (supabase/tests/9x_battle_games.sql)
  ["bear", 42, 3, -1, { end: 170, ranking: [2, 1, 0], out: [110, 170, -1], score: [23, 32, 22] }],
  [
    "bear",
    7,
    6,
    -1,
    { end: 288, ranking: [0, 5, 4, 2, 1, 3], out: [-1, 136, 146, 75, 239, 288], score: [53, 27, 25, 16, 43, 44] },
  ],
  [
    "bear",
    99,
    10,
    -1,
    {
      end: 421,
      ranking: [8, 0, 7, 6, 2, 5, 9, 3, 4, 1],
      out: [421, 47, 259, 110, 84, 194, 314, 380, -1, 136],
      score: [69, 6, 47, 20, 14, 28, 58, 53, 78, 23],
    },
  ],
  ["bear", 2026, 4, 100, { end: 179, ranking: [0, 3, 2, 1], out: [-1, 75, 147, 179], score: [33, 12, 25, 14] }],
  ["dash", 42, 3, -1, { end: 1199, ranking: [2, 1, 0], out: [-1, -1, -1], score: [0, 0, 5] }],
  [
    "dash",
    7,
    6,
    -1,
    { end: 1199, ranking: [5, 1, 0, 2, 3, 4], out: [-1, -1, -1, -1, -1, -1], score: [4, 5, 3, 3, 1, 5] },
  ],
  [
    "dash",
    99,
    10,
    -1,
    {
      end: 1016,
      ranking: [4, 1, 5, 7, 6, 9, 2, 8, 3, 0],
      out: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
      score: [2, 6, 4, 3, 8, 6, 5, 5, 4, 5],
    },
  ],
  ["dash", 2026, 4, 100, { end: 1199, ranking: [0, 2, 1, 3], out: [-1, -1, -1, 179], score: [3, 0, 0, 0] }],
  ["margin", 42, 3, -1, { end: 1799, ranking: [0, 2, 1], out: [-1, -1, -1], score: [0, 0, 0] }],
  [
    "margin",
    7,
    6,
    -1,
    { end: 1078, ranking: [2, 3, 5, 1, 0, 4], out: [130, 130, -1, 1078, 130, 130], score: [3, 2, 0, 5, 5, 1] },
  ],
  [
    "margin",
    99,
    10,
    -1,
    {
      end: 130,
      ranking: [8, 4, 1, 7, 5, 0, 2, 6, 9, 3],
      out: [130, 130, 130, 130, 130, 130, 130, 130, -1, 130],
      score: [1, 1, 2, 3, 1, 1, 2, 1, 0, 2],
    },
  ],
  ["margin", 2026, 4, 100, { end: 1468, ranking: [2, 0, 1, 3], out: [1468, 1468, -1, 179], score: [2, 5, 0, 0] }],
  ["elevator", 42, 3, -1, { end: 119, ranking: [2, 1, 0], out: [72, 119, -1], score: [1, 4, -1] }],
  [
    "elevator",
    7,
    6,
    -1,
    { end: 188, ranking: [2, 1, 3, 5, 4, 0], out: [64, 188, -1, 182, 76, 115], score: [6, 0, -1, 1, 6, 0] },
  ],
  [
    "elevator",
    99,
    10,
    -1,
    {
      end: 284,
      ranking: [1, 3, 5, 0, 2, 6, 9, 8, 7, 4],
      out: [204, -1, 176, 284, 112, 258, 176, 119, 119, 144],
      score: [0, -4, 1, -3, 0, 0, 3, 6, 3, 3],
    },
  ],
  ["elevator", 2026, 4, 100, { end: 204, ranking: [2, 0, 1, 3], out: [204, 82, -1, 74], score: [1, 4, 0, 5] }],
  ["laser", 42, 3, -1, { end: 340, ranking: [1, 0, 2], out: [340, -1, 336], score: [0, 1, 0] }],
  [
    "laser",
    7,
    6,
    -1,
    { end: 324, ranking: [3, 5, 0, 2, 1, 4], out: [272, 258, 262, -1, 208, 324], score: [0, 0, 0, 1, 0, 0] },
  ],
  [
    "laser",
    99,
    10,
    -1,
    {
      end: 326,
      ranking: [4, 2, 6, 5, 1, 8, 9, 0, 7, 3],
      out: [208, 264, 326, 200, -1, 266, 318, 204, 216, 212],
      score: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    },
  ],
  ["laser", 2026, 4, 100, { end: 254, ranking: [1, 0, 2, 3], out: [254, -1, 204, 179], score: [0, 3, 0, 2] }],
  ["rodeo", 42, 3, -1, { end: 328, ranking: [0, 2, 1], out: [-1, 328, 328], score: [41, 14, 19] }],
  [
    "rodeo",
    7,
    6,
    -1,
    { end: 346, ranking: [4, 0, 5, 2, 3, 1], out: [346, 181, 216, 216, -1, 286], score: [52, 0, 24, 21, 73, 25] },
  ],
  [
    "rodeo",
    99,
    10,
    -1,
    {
      end: 270,
      ranking: [4, 2, 1, 6, 9, 0, 3, 7, 8, 5],
      out: [169, 169, 270, 169, -1, 138, 169, 169, 138, 169],
      score: [19, 23, 25, 18, 57, 0, 23, 13, 0, 19],
    },
  ],
  ["rodeo", 2026, 4, 100, { end: 268, ranking: [1, 2, 0, 3], out: [192, -1, 268, 179], score: [18, 61, 40, 47] }],
];

function scoreOf(kind: TickKind, state: ReturnType<typeof simulateBattle>): number[] {
  const s = state as unknown as Record<string, number[]>;
  if (kind === "coins" || kind === "pump") return s.score!;
  if (kind === "bulls") return s.hearts!;
  if (kind === "sumo") return s.pushes!;
  if (kind === "potato") return s.held!;
  if (kind === "dash" || kind === "rodeo") return s.score!;
  if (kind === "margin") return s.dist!;
  if (kind === "elevator") return s.best!;
  if (kind === "laser") return s.hearts!;
  return state.p.steps;
}

describe("battle simulation vectors", () => {
  it("the hash matches the SQL hash", () => {
    expect([battleHash(0, 0, 0), battleHash(12345, 1, 2), battleHash(4294967295, 999, 7)]).toEqual([
      3904035322, 2478510442, 3673303681,
    ]);
  });

  it("covers every action game", () => {
    expect(new Set(VECTORS.map((v) => v[0]))).toEqual(new Set(TICK_KINDS));
  });

  for (const [kind, seed, n, cut, expected] of VECTORS) {
    it(`${kind}: seed ${seed}, ${n} players${cut >= 0 ? ", one disconnects" : ""}`, () => {
      const streams = Array.from({ length: n }, (_, i) => {
        const s = botStream(seed, kind, i, 2000);
        return cut >= 0 && i === n - 1 ? s.slice(0, cut) : s;
      });
      const state = simulateBattle(kind, seed, streams, 2000, defaultSimParams(kind) as never);
      expect(state.done).toBe(true);
      expect({
        end: state.endTick,
        ranking: battleRanking(kind, state),
        out: state.p.out,
        score: scoreOf(kind, state),
      }).toEqual(expected);
    });
  }
});
