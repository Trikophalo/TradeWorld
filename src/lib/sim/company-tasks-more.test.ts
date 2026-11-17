import { describe, expect, it } from "vitest";
import { COMPANY_TASK_RULES, COMPANY_TASKS, type CompanyTaskConfig } from "../../config/company-tasks.ts";
import { bestPack, bestTour, generatePuzzle, gradeAnswer, mathValue, tourLength } from "./company-tasks.ts";
import { bestLoad, bestOrder, memoryPairs } from "./company-tasks.fixtures.ts";

/* ADR-173: the eight new task games, their puzzles and their scoring. */

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}
const g = COMPANY_TASK_RULES.games;
const taskOf = (game: CompanyTaskConfig["game"]) => COMPANY_TASKS.find((t) => t.game === game)!;

describe("ADR-173 task games", () => {
  it("every new game has at least one task in two different departments or products", () => {
    for (const game of ["memory", "timing", "diff", "quick", "route", "haggle", "pack", "catch"] as const) {
      const tasks = COMPANY_TASKS.filter((t) => t.game === game);
      expect(tasks.length, game).toBeGreaterThanOrEqual(2);
      expect(new Set(tasks.map((t) => `${t.branch}:${t.product}`)).size, game).toBeGreaterThanOrEqual(2);
    }
  });

  it("memory: all pairs full marks, each wrong flip costs missBps, foreign or reused cards count nothing", () => {
    const { solution } = generatePuzzle(taskOf("memory"), seeded(3));
    const cards = (solution as { cards: number[] }).cards;
    expect(cards).toHaveLength(g.memory.pairs * 2);
    const pairs = memoryPairs(cards);
    expect(gradeAnswer("memory", solution, { pairs, misses: 0 })).toBe(10_000);
    expect(gradeAnswer("memory", solution, { pairs, misses: 3 })).toBe(10_000 - 3 * g.memory.missBps);
    expect(gradeAnswer("memory", solution, { pairs: pairs.slice(0, 2), misses: 0 })).toBe(5_000);
    // the same pair twice counts once; a pair of different cards not at all
    expect(gradeAnswer("memory", solution, { pairs: [pairs[0], pairs[0]], misses: 0 })).toBe(2_500);
    const odd = cards.findIndex((c) => c !== cards[0]);
    expect(gradeAnswer("memory", solution, { pairs: [[0, odd]], misses: 0 })).toBe(0);
    expect(gradeAnswer("memory", solution, { pairs, misses: 100 })).toBe(0);
    expect(gradeAnswer("memory", solution, { pairs: "x" })).toBe(0);
  });

  it("timing: within the tolerance full marks, within 3× half, else nothing", () => {
    const { puzzle, solution } = generatePuzzle(taskOf("timing"), seeded(5));
    const targets = (puzzle as { targets: number[] }).targets;
    expect(targets).toHaveLength(g.timing.rounds);
    for (const t of targets) expect(t).toBeGreaterThanOrEqual(g.timing.min);
    const tol = g.timing.tolerance;
    expect(gradeAnswer("timing", solution, { stops: targets.map((t) => t + tol) })).toBe(10_000);
    expect(gradeAnswer("timing", solution, { stops: targets.map((t) => t - 2 * tol) })).toBe(5_000);
    expect(gradeAnswer("timing", solution, { stops: targets.map((t) => t + 4 * tol) })).toBe(0);
    expect(gradeAnswer("timing", solution, { stops: [targets[0]] })).toBe(3_333);
  });

  it("diff: the right grid differs exactly in the solution's cells; graded like pick", () => {
    const rng = seeded(11);
    for (let k = 0; k < 20; k++) {
      const { puzzle, solution } = generatePuzzle(taskOf("diff"), rng);
      const { left, right } = puzzle as { left: number[]; right: number[] };
      const targets = (solution as { targets: number[] }).targets;
      expect(left.flatMap((l, i) => (l !== right[i] ? [i] : []))).toEqual(targets);
      expect(targets.length).toBeGreaterThanOrEqual(g.diff.minDiffs);
      expect(right.every((x) => x >= 0 && x < g.diff.symbols)).toBe(true);
      expect(gradeAnswer("diff", solution, { picked: targets })).toBe(10_000);
    }
    const { solution } = generatePuzzle(taskOf("diff"), seeded(2));
    const targets = (solution as { targets: number[] }).targets;
    const wrong = [...Array(g.diff.cells).keys()].find((i) => !targets.includes(i))!;
    expect(gradeAnswer("diff", solution, { picked: [...targets, wrong] })).toBeLessThan(10_000);
  });

  it("quick: every problem has distinct options, one of them right", () => {
    const rng = seeded(13);
    for (const task of COMPANY_TASKS.filter((t) => t.game === "quick")) {
      const { puzzle, solution } = generatePuzzle(task, rng);
      const { problems } = puzzle as {
        problems: { a: number; b: number; op: NonNullable<CompanyTaskConfig["op"]>; options: number[] }[];
      };
      const { choices } = solution as { choices: number[] };
      expect(problems).toHaveLength(g.quick.problems);
      problems.forEach((p, i) => {
        expect(new Set(p.options).size).toBe(g.quick.options);
        expect(p.options[choices[i]!]).toBe(mathValue(p.op, p.a, p.b));
      });
      expect(gradeAnswer("quick", solution, { choices })).toBe(10_000);
      expect(gradeAnswer("quick", solution, { choices: choices.map((c) => (c + 1) % 3) })).toBe(0);
    }
  });

  it("route: the best round trip full marks, every extra field costs stepBps, a broken order nothing", () => {
    const pts: [number, number][] = [
      [0, 0],
      [3, 0],
      [0, 3],
      [3, 3],
      [1, 0],
    ];
    expect(bestTour(pts)).toBe(12);
    expect(tourLength(pts, [1, 2, 3, 4])).toBe(18);
    const solution = { points: pts, best: 12, step_bps: g.route.stepBps };
    expect(gradeAnswer("route", solution, { order: bestOrder(pts) })).toBe(10_000);
    expect(gradeAnswer("route", solution, { order: [1, 2, 3, 4] })).toBe(10_000 - 6 * g.route.stepBps);
    expect(gradeAnswer("route", solution, { order: [1, 2, 3] })).toBe(0);
    expect(gradeAnswer("route", solution, { order: [1, 1, 3, 4] })).toBe(0);
    expect(gradeAnswer("route", solution, { order: [0, 2, 3, 4] })).toBe(0);
    const { puzzle } = generatePuzzle(taskOf("route"), seeded(17));
    const points = (puzzle as { points: [number, number][] }).points;
    expect(points).toHaveLength(g.route.stops + 1);
    expect(new Set(points.map(([x, y]) => `${x},${y}`)).size).toBe(points.length);
  });

  it("haggle: best reply full marks, the middle one okBps, the bad one nothing; averaged over rounds", () => {
    const solution = {
      rounds: [
        [2, 0, 1],
        [0, 1, 2],
        [1, 2, 0],
      ],
      ok_bps: g.haggle.okBps,
    };
    expect(gradeAnswer("haggle", solution, { choices: [1, 0, 2] })).toBe(10_000);
    expect(gradeAnswer("haggle", solution, { choices: [2, 1, 0] })).toBe(5_000);
    expect(gradeAnswer("haggle", solution, { choices: [0, 2, 1] })).toBe(0);
    expect(gradeAnswer("haggle", solution, { choices: [1, 0] })).toBe(6_666);
    expect(gradeAnswer("haggle", solution, { choices: [9, 0, 2] })).toBe(6_666);
  });

  it("pack: value against the best load; over the capacity nothing", () => {
    const weights = [5, 4, 3, 2];
    const values = [10, 8, 4, 5];
    expect(bestPack(weights, values, 7)).toBe(15);
    const solution = { weights, values, cap: 7, best: 15 };
    expect(gradeAnswer("pack", solution, { picked: bestLoad(weights, values, 7) })).toBe(10_000);
    expect(gradeAnswer("pack", solution, { picked: [1, 2] })).toBe(8_000);
    expect(gradeAnswer("pack", solution, { picked: [0, 1] })).toBe(0);
    expect(gradeAnswer("pack", solution, { picked: [0, 0] })).toBe(0);
    const { puzzle } = generatePuzzle(taskOf("pack"), seeded(19));
    const p = puzzle as { weights: number[]; cap: number };
    expect(p.weights).toHaveLength(g.pack.items);
    expect(p.cap).toBeLessThan(p.weights.reduce((a, b) => a + b, 0));
  });

  it("catch: at least two good tiles, never twice on one field in a row; graded like pick", () => {
    const rng = seeded(23);
    for (let k = 0; k < 30; k++) {
      const { puzzle, solution } = generatePuzzle(taskOf("catch"), rng);
      const { events } = puzzle as { events: { cell: number; good: boolean }[] };
      expect(events).toHaveLength(g.catch.events);
      expect(events.filter((e) => e.good).length).toBeGreaterThanOrEqual(2);
      events.forEach((e, i) => i > 0 && expect(e.cell).not.toBe(events[i - 1]!.cell));
      const targets = (solution as { targets: number[] }).targets;
      expect(gradeAnswer("catch", solution, { picked: targets })).toBe(10_000);
      expect(gradeAnswer("catch", solution, { picked: [] })).toBe(0);
    }
    // the whole sweep fits into the time limit
    expect(g.catch.events * g.catch.everyMs).toBeLessThan(g.catch.seconds * 1000);
  });
});
