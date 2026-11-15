import { describe, expect, it } from "vitest";
import { BATTLE_RULES } from "../../../config/battles.ts";
import {
  bellEval,
  bellHearts,
  bellRanking,
  bellTimes,
  errorBps,
  estimateEval,
  estimateRanking,
  quizEval,
  quizPoints,
  quizRanking,
  quizTimes,
} from "./rounds.ts";

const g = BATTLE_RULES.games;

describe("Börsenquiz", () => {
  it("rounds follow each other: answer time, then the reveal", () => {
    const t = quizTimes(1000, 2, g.quiz);
    expect(t.opens).toBe(1000 + 2 * (g.quiz.answerMs + g.quiz.revealMs));
    expect(t.closes - t.opens).toBe(g.quiz.answerMs);
  });

  it("fast right answers score more", () => {
    expect(quizPoints(0, g.quiz)).toBe(1000);
    expect(quizPoints(2000, g.quiz)).toBe(875);
    expect(quizPoints(g.quiz.answerMs, g.quiz)).toBe(500);
  });

  it("wrong or none costs a heart, all wrong costs nobody, the last with hearts wins", () => {
    const answers = [
      [
        { slot: 0, choice: 1, ms: 2000 },
        { slot: 1, choice: 3, ms: 1000 },
      ],
      [
        { slot: 0, choice: 2, ms: 1000 },
        { slot: 1, choice: 2, ms: 1000 },
        { slot: 2, choice: 2, ms: 1000 },
      ],
      [{ slot: 0, choice: 0, ms: 3000 }],
    ];
    const s = quizEval(3, [1, 0, 0], answers, [-1, -1, -1], 3, g.quiz);
    expect(s.hearts).toEqual([2, 0, 0]);
    expect(s.results[1]!.lost).toEqual([]);
    expect(s.done).toBe(true);
    expect(quizRanking(1, s)[0]).toBe(0);
  });

  it("a player who left is out from that round on", () => {
    const s = quizEval(3, [0], [[]], [-1, 0, -1], 1, g.quiz);
    expect(s.out[1]).toBe(0);
  });
});

describe("Schätz den Kurs", () => {
  it("the closest gets the most points, a bullseye a bonus, the last round counts double", () => {
    expect(errorBps(101, 100)).toBe(100);
    const s = estimateEval(
      3,
      [100, 50],
      [
        [
          { slot: 0, value: 100, ms: 5000 },
          { slot: 1, value: 120, ms: 1000 },
          { slot: 2, value: 90, ms: 2000 },
        ],
        [{ slot: 1, value: 50, ms: 1000 }],
      ],
      [-1, -1, -1],
      2,
      { ...g.estimate, rounds: 2 as never },
    );
    // round 1: A exact (3 + 2), C 10 % off (2), B 20 % off (1); round 2 counts double: only B, exact ((1 + 2) × 2)
    expect(s.points).toEqual([5, 1 + 6, 2]);
    expect(estimateRanking(1, s)[0]).toBe(1);
    expect(s.done).toBe(true);
  });
});

describe("Die Glocke", () => {
  it("rings after the ready time plus the secret wait", () => {
    const t = bellTimes(0, 1, 2000, g.bell);
    expect(t.bell - t.slot).toBe(g.bell.readyMs + 2000);
    expect(t.closes - t.bell).toBe(g.bell.windowMs);
  });

  it("a false start and no press lose a heart; with nobody wrong the slowest loses one", () => {
    expect(bellHearts(3, g.bell)).toBe(2);
    expect(bellHearts(8, g.bell)).toBe(1);
    const s = bellEval(
      1,
      3,
      [
        [
          { slot: 0, ms: 250 },
          { slot: 1, ms: -300 },
        ],
        [
          { slot: 0, ms: 200 },
          { slot: 1, ms: 300 },
          { slot: 2, ms: 400 },
        ],
      ],
      [-1, -1, -1],
      2,
      g.bell,
    );
    expect(s.results[0]!.lost).toEqual([1, 2]);
    expect(s.results[1]!.lost).toEqual([2]);
    expect(s.hearts).toEqual([2, 1, 0]);
    expect(bellRanking(1, s)[0]).toBe(0);
  });

  it("when everyone fails nobody loses", () => {
    const s = bellEval(1, 2, [[{ slot: 0, ms: -10 }]], [-1, -1], 1, g.bell);
    expect(s.hearts).toEqual([2, 2]);
  });
});
