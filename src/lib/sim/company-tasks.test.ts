import { describe, expect, it } from "vitest";
import { COMPANY_TASK_RULES, COMPANY_TASKS } from "../../config/company-tasks.ts";
import { bestLoad, bestOrder, memoryPairs } from "./company-tasks.fixtures.ts";
import {
  aiMinutes,
  generatePuzzle,
  gradeAnswer,
  mathValue,
  shortestPath,
  shortestRoute,
  taskResultCents,
  type PathSolution,
  type TaskSolution,
} from "./company-tasks.ts";

/** The answer a perfect player gives: the solution itself, a picked list or a shortest route. */
function perfectAnswer(solution: TaskSolution): Record<string, unknown> {
  if ("targets" in solution) return { picked: solution.targets };
  if ("miss_bps" in solution) return { pairs: memoryPairs(solution.cards), misses: 0 };
  if ("points" in solution) return { order: bestOrder(solution.points) };
  if ("ok_bps" in solution) return { choices: solution.rounds.map((perm) => perm.indexOf(0)) };
  if ("cap" in solution) return { picked: bestLoad(solution.weights, solution.values, solution.cap) };
  if ("walls" in solution) {
    return { path: shortestRoute(solution.size, solution.start, solution.goal, solution.walls) };
  }
  return solution;
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

describe("company task games", () => {
  it("builds a solvable puzzle for every task; the solution itself scores full marks", () => {
    const rng = seeded(7);
    for (const task of COMPANY_TASKS) {
      for (let k = 0; k < 5; k++) {
        const { solution } = generatePuzzle(task, rng);
        expect(gradeAnswer(task.game, solution, perfectAnswer(solution)), task.key).toBe(10_000);
      }
    }
  });

  it("order values stay in the task's realistic range and are all different", () => {
    const rng = seeded(5);
    for (const task of COMPANY_TASKS.filter((t) => t.game === "order")) {
      expect(task.range, task.key).toBeDefined();
      const [lo, hi] = task.range!;
      expect(hi - lo + 1, task.key).toBeGreaterThanOrEqual(COMPANY_TASK_RULES.games.order.items * 2);
      for (let k = 0; k < 10; k++) {
        const { puzzle } = generatePuzzle(task, rng);
        const values = (puzzle as { values: number[] }).values;
        expect(new Set(values).size, task.key).toBe(values.length);
        for (const v of values) expect(v >= lo && v <= hi, `${task.key} ${v}`).toBe(true);
      }
    }
  });

  it("math answers are whole and never negative", () => {
    const rng = seeded(11);
    for (const task of COMPANY_TASKS.filter((t) => t.game === "math")) {
      for (let k = 0; k < 20; k++) {
        const { solution } = generatePuzzle(task, rng);
        const v = (solution as { value: number }).value;
        expect(Number.isInteger(v), task.key).toBe(true);
        expect(v, task.key).toBeGreaterThanOrEqual(0);
      }
    }
    expect(mathValue("pct", 2500, 20)).toBe(500);
  });

  it("pick: wrong taps cost as much as hits earn", () => {
    const sol: TaskSolution = { targets: [1, 4, 7] };
    expect(gradeAnswer("pick", sol, { picked: [1, 4, 7] })).toBe(10_000);
    expect(gradeAnswer("pick", sol, { picked: [1, 4, 2] })).toBe(3_333);
    expect(gradeAnswer("pick", sol, { picked: [0, 2, 3, 5] })).toBe(0);
    expect(gradeAnswer("pick", sol, { picked: [1, 1, 1] })).toBe(3_333);
  });

  it("count is off by one for half, order and sequence count positions", () => {
    expect(gradeAnswer("count", { count: 6 }, { count: 5 })).toBe(5_000);
    expect(gradeAnswer("count", { count: 6 }, { count: 4 })).toBe(0);
    expect(gradeAnswer("sort", { sides: [0, 1, 1, 0] }, { sides: [0, 1, 0, 0] })).toBe(7_500);
    expect(gradeAnswer("seq", { sequence: [3, 1, 1, 0, 2] }, { sequence: "nope" })).toBe(0);
    expect(gradeAnswer("math", { value: 42 }, null)).toBe(0);
  });

  it("success earns, failure costs, the AI earns less and gets slower", () => {
    expect(taskResultCents(44_000, 10_000, false)).toBe(44_000);
    expect(taskResultCents(44_000, 9_000, true)).toBe(23_760);
    expect(taskResultCents(44_000, 5_000, false)).toBe(-26_400);
    expect(taskResultCents(44_000, null, false)).toBe(-26_400);
    expect(aiMinutes(0)).toBe(COMPANY_TASK_RULES.ai.minutes);
    expect(aiMinutes(2)).toBeGreaterThan(aiMinutes(1));
    // ADR-134: task_pay, task_safety and ai_turbo of the founder
    expect(taskResultCents(40_000, 10_000, false, COMPANY_TASK_RULES, { payBonusBps: 2_000 })).toBe(48_000);
    expect(taskResultCents(44_000, null, false, COMPANY_TASK_RULES, { penaltyDiscountBps: 2_500 })).toBe(-19_800);
    expect(aiMinutes(0, COMPANY_TASK_RULES, 3_000)).toBe(Math.ceil(COMPANY_TASK_RULES.ai.minutes * 0.7));
    expect(aiMinutes(0, COMPANY_TASK_RULES, 10_000)).toBe(1);
  });

  it("slider: within the tolerance full marks, within three times half, the puzzle shows the gaps", () => {
    const rng = seeded(21);
    const g = COMPANY_TASK_RULES.games.slider;
    const task = COMPANY_TASKS.find((t) => t.game === "slider")!;
    for (let k = 0; k < 20; k++) {
      const { puzzle, solution } = generatePuzzle(task, rng);
      const targets = (puzzle as { targets: number[] }).targets;
      expect(targets).toHaveLength(g.sliders);
      expect((solution as { positions: number[] }).positions).toEqual(targets);
      for (const v of targets) expect(v >= g.min && v <= g.max).toBe(true);
    }
    const sol: TaskSolution = { positions: [30, 50, 70], tolerance: 3 };
    expect(gradeAnswer("slider", sol, { positions: [33, 47, 70] })).toBe(10_000);
    expect(gradeAnswer("slider", sol, { positions: [34, 50, 70] })).toBe(8_333);
    expect(gradeAnswer("slider", sol, { positions: [40, 50, 0] })).toBe(3_333);
    expect(gradeAnswer("slider", sol, { positions: [0, 0, 0] })).toBe(0);
    expect(gradeAnswer("slider", sol, { positions: [30, "x"] })).toBe(3_333);
    expect(gradeAnswer("slider", sol, { positions: 30 })).toBe(0);
  });

  it("rotate: every dial starts turned away; one step off is half, the turn wraps around", () => {
    const rng = seeded(23);
    const g = COMPANY_TASK_RULES.games.rotate;
    const task = COMPANY_TASKS.find((t) => t.game === "rotate")!;
    for (let k = 0; k < 20; k++) {
      const { puzzle } = generatePuzzle(task, rng);
      const { start, target, steps } = puzzle as { start: number[]; target: number[]; steps: number };
      expect(start).toHaveLength(g.dials);
      start.forEach((s, i) => {
        const d = Math.abs(s - target[i]!) % steps;
        expect(Math.min(d, steps - d)).toBeGreaterThanOrEqual(g.minTurn);
      });
      // already right at the start would be a free win: never all three
      expect(gradeAnswer("rotate", { dials: target, steps }, { dials: start })).toBe(0);
    }
    const sol: TaskSolution = { dials: [0, 3, 7], steps: 8 };
    expect(gradeAnswer("rotate", sol, { dials: [0, 3, 7] })).toBe(10_000);
    expect(gradeAnswer("rotate", sol, { dials: [7, 3, 0] })).toBe(6_666);
    expect(gradeAnswer("rotate", sol, { dials: [4, 5, 3] })).toBe(0);
    expect(gradeAnswer("rotate", sol, { dials: [8, 11, 15] })).toBe(10_000);
  });

  it("match: two cards of each box, each in the box its group names; graded per card", () => {
    const rng = seeded(29);
    const g = COMPANY_TASK_RULES.games.match;
    for (const task of COMPANY_TASKS.filter((t) => t.game === "match")) {
      const { puzzle, solution } = generatePuzzle(task, rng);
      const { items } = puzzle as { items: number[] };
      const boxes = (solution as { boxes: number[] }).boxes;
      expect(items).toHaveLength(g.boxes * g.perBox);
      expect(new Set(items).size).toBe(items.length);
      items.forEach((item, k) => expect(boxes[k]).toBe(Math.floor(item / g.groupSize)));
      for (let b = 0; b < g.boxes; b++) expect(boxes.filter((x) => x === b)).toHaveLength(g.perBox);
    }
    const sol: TaskSolution = { boxes: [0, 2, 1, 1, 0, 2] };
    expect(gradeAnswer("match", sol, { boxes: [0, 2, 1, 1, 0, 2] })).toBe(10_000);
    expect(gradeAnswer("match", sol, { boxes: [0, 2, 1, 1, 2, 0] })).toBe(6_666);
    expect(gradeAnswer("match", sol, { boxes: [-1, -1, -1, -1, -1, -1] })).toBe(0);
  });

  it("path: the walls force a detour, the route exists; detours cost, broken routes score nothing", () => {
    const rng = seeded(31);
    const g = COMPANY_TASK_RULES.games.path;
    const task = COMPANY_TASKS.find((t) => t.game === "path")!;
    for (let k = 0; k < 30; k++) {
      const { puzzle, solution } = generatePuzzle(task, rng);
      const p = puzzle as { size: number; start: number; goal: number; walls: number[] };
      const sol = solution as PathSolution;
      expect(p.start % p.size).toBe(0);
      expect(p.goal % p.size).toBe(p.size - 1);
      expect(p.walls.length).toBeGreaterThanOrEqual(g.minWalls);
      expect(p.walls).not.toContain(p.start);
      expect(p.walls).not.toContain(p.goal);
      expect(sol.length).toBe(shortestPath(p.size, p.start, p.goal, p.walls));
      const manhattan = Math.abs(Math.floor(p.start / p.size) - Math.floor(p.goal / p.size)) + p.size - 1;
      expect(sol.length).toBeGreaterThanOrEqual(manhattan + g.minDetour);
    }
    // 3×3: start 0, goal 2, wall 1 -> 0 3 4 5 2 (4 moves)
    const sol: PathSolution = { size: 3, start: 0, goal: 2, walls: [1], length: 4, step_bps: 1_000 };
    expect(gradeAnswer("path", sol, { path: [0, 3, 4, 5, 2] })).toBe(10_000);
    expect(gradeAnswer("path", sol, { path: [0, 3, 6, 7, 4, 5, 2] })).toBe(8_000);
    expect(gradeAnswer("path", sol, { path: [0, 1, 2] })).toBe(0); // through the wall
    expect(gradeAnswer("path", sol, { path: [0, 4, 5, 2] })).toBe(0); // diagonal
    expect(gradeAnswer("path", sol, { path: [0, 3, 4, 5] })).toBe(0); // not at the goal
    expect(gradeAnswer("path", sol, { path: [0, 3, 4, 3, 4, 5, 2] })).toBe(0); // a cell twice
    expect(gradeAnswer("path", sol, { path: "0,3,4,5,2" })).toBe(0);
    expect(shortestRoute(3, 0, 2, [1, 4, 7])).toBeNull();
  });
});
