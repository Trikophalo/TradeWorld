import { describe, expect, it } from "vitest";
import { COMPANY_TASK_RULES, COMPANY_TASKS } from "../../config/company-tasks.ts";
import {
  aiMinutes,
  generatePuzzle,
  gradeAnswer,
  mathValue,
  taskResultCents,
  type TaskSolution,
} from "./company-tasks.ts";

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
        const answer = "targets" in solution ? { picked: solution.targets } : solution;
        expect(gradeAnswer(task.game, solution, answer), task.key).toBe(10_000);
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
  });
});
