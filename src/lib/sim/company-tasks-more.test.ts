import { describe, expect, it } from "vitest";
import { COMPANY_TASK_RULES, COMPANY_TASKS } from "../../config/company-tasks.ts";
import { generatePuzzle, gradeAnswer } from "./company-tasks.ts";
import { MORE_TASK_GAMES, patternRow, shelfBase, type MoreTaskGame } from "./company-tasks-more.ts";
import { createRng } from "./rng.ts";

const task = (game: MoreTaskGame) => COMPANY_TASKS.find((t) => t.game === game)!;
const rngOf = (seed: number) => {
  const r = createRng(seed);
  return () => r.next();
};

describe("five more task games (ADR-180)", () => {
  it("every new game has a task in the catalogue and a config", () => {
    for (const g of MORE_TASK_GAMES) {
      expect(task(g)).toBeDefined();
      expect(COMPANY_TASK_RULES.games[g].seconds).toBeGreaterThan(0);
    }
  });

  it("restock: exact amounts full marks, one off half, more off nothing", () => {
    const { puzzle, solution } = generatePuzzle(task("restock"), rngOf(1));
    const p = puzzle as { stock: number[]; target: number[] };
    const right = p.target.map((t, i) => t - p.stock[i]!);
    expect(right.every((v) => v >= 2)).toBe(true);
    expect(gradeAnswer("restock", solution, { values: right })).toBe(10_000);
    const oneOff = right.map((v, i) => (i === 0 ? v + 1 : v));
    expect(gradeAnswer("restock", solution, { values: oneOff })).toBe(8_750);
    expect(gradeAnswer("restock", solution, { values: right.map(() => 0) })).toBe(0);
    expect(gradeAnswer("restock", solution, { values: "x" })).toBe(0);
  });

  it("receipts: the right sum full marks, every euro off costs 5 %", () => {
    for (let seed = 1; seed < 20; seed++) {
      const { puzzle, solution } = generatePuzzle(task("receipts"), rngOf(seed));
      const p = puzzle as { amounts: number[]; target: number };
      // find any subset with the right sum (there is at least the drawn one)
      let best: number[] | null = null;
      for (let m = 1; m < 1 << p.amounts.length && !best; m++) {
        const idx = p.amounts.flatMap((_, i) => (m & (1 << i) ? [i] : []));
        if (idx.reduce((s, i) => s + p.amounts[i]!, 0) === p.target) best = idx;
      }
      expect(best).not.toBeNull();
      expect(gradeAnswer("receipts", solution, { picked: best })).toBe(10_000);
    }
    const sol = { amounts: [10, 20, 30], target: 30, step_bps: 500, picked: [2] };
    expect(gradeAnswer("receipts", sol, { picked: [0] })).toBe(0);
    expect(gradeAnswer("receipts", sol, { picked: [1] })).toBe(5_000);
    expect(gradeAnswer("receipts", sol, { picked: [0, 0] })).toBe(0);
    expect(gradeAnswer("receipts", sol, { picked: [7] })).toBe(0);
  });

  it("offer: the customer with the highest revenue, one per round, always unique", () => {
    for (let seed = 1; seed < 30; seed++) {
      const { puzzle, solution } = generatePuzzle(task("offer"), rngOf(seed));
      const p = puzzle as { offers: [number, number][][] };
      const choices = p.offers.map((round) => {
        const rev = round.map(([a, b]) => a * b);
        const top = Math.max(...rev);
        expect(rev.filter((r) => r === top)).toHaveLength(1);
        return rev.indexOf(top);
      });
      expect(gradeAnswer("offer", solution, { choices })).toBe(10_000);
    }
    expect(gradeAnswer("offer", { choices: [0, 1, 2] }, { choices: [0, 1, 0] })).toBe(6_666);
  });

  it("pattern: rows add, double or grow; the right next number is among the options", () => {
    expect(patternRow(0, 3, 4, 5)).toEqual([3, 7, 11, 15, 19]);
    expect(patternRow(1, 3, 0, 5)).toEqual([3, 6, 12, 24, 48]);
    expect(patternRow(2, 1, 2, 5)).toEqual([1, 3, 6, 10, 15]);
    const { puzzle, solution } = generatePuzzle(task("pattern"), rngOf(7));
    const rows = (puzzle as { rows: { seq: number[]; options: number[] }[] }).rows;
    expect(rows).toHaveLength(COMPANY_TASK_RULES.games.pattern.rounds);
    for (const r of rows) expect(new Set(r.options).size).toBe(3);
    const choices = (solution as { choices: number[] }).choices;
    expect(gradeAnswer("pattern", solution, { choices })).toBe(10_000);
  });

  it("shelf: the base grid is valid; a solved shelf full marks; changed givens nothing", () => {
    const base = shelfBase();
    for (let r = 0; r < 4; r++) expect(new Set(base.slice(r * 4, r * 4 + 4)).size).toBe(4);
    for (let c = 0; c < 4; c++) expect(new Set([0, 1, 2, 3].map((r) => base[r * 4 + c])).size).toBe(4);
    const { puzzle, solution } = generatePuzzle(task("shelf"), rngOf(3));
    const grid = (puzzle as { grid: number[] }).grid;
    const sol = solution as { grid: number[]; blanks: number[] };
    expect(grid.filter((v) => v < 0)).toHaveLength(COMPANY_TASK_RULES.games.shelf.blanks);
    expect(gradeAnswer("shelf", solution, { grid: sol.grid })).toBe(10_000);
    // one wrong gap: that gap and its twins in row, column or box count as wrong
    const wrong = [...sol.grid];
    const g0 = sol.blanks[0]!;
    wrong[g0] = (wrong[g0]! + 1) % 4;
    expect(gradeAnswer("shelf", solution, { grid: wrong })).toBeLessThan(10_000);
    const tampered = [...sol.grid];
    const fixed = [...Array(16).keys()].find((i) => !sol.blanks.includes(i))!;
    tampered[fixed] = (tampered[fixed]! + 1) % 4;
    expect(gradeAnswer("shelf", solution, { grid: tampered })).toBe(0);
    expect(gradeAnswer("shelf", solution, { grid: [1, 2] })).toBe(0);
  });
});
