import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPANY_TASK_RULES, COMPANY_TASKS } from "../../config/company-tasks.ts";
import { generatePuzzle, gradeAnswer } from "./company-tasks.ts";
import {
  crossings,
  pipeRoute,
  pipesConnected,
  segmentsMeet,
  tilesInPlace,
  turnMask,
  VISUAL_TASK_GAMES,
  type Point,
  type VisualTaskGame,
} from "./company-tasks-visual.ts";
import { tileMoves } from "./company-tasks.fixtures.ts";
import { createRng } from "./rng.ts";

const task = (game: VisualTaskGame) => COMPANY_TASKS.find((t) => t.game === game)!;
const rngOf = (seed: number) => {
  const r = createRng(seed);
  return () => r.next();
};
const g = COMPANY_TASK_RULES.games;

// The same cases run in SQL (supabase/tests/c5_task_games_visual.sql): both sides must agree exactly.
const raw = readFileSync(new URL("../../../supabase/tests/task_games_visual_cases.inc", import.meta.url), "utf8");
const CASES = JSON.parse(raw.slice(raw.indexOf("$cases$") + 7, raw.lastIndexOf("$cases$"))) as {
  name: string;
  game: VisualTaskGame;
  solution: unknown;
  answer: unknown;
  score: number;
}[];

describe("drag and see task games (ADR-186)", () => {
  it("gives exactly the shared scores (same cases as the SQL test)", () => {
    expect(CASES.length).toBeGreaterThan(100);
    for (const c of CASES) expect(gradeAnswer(c.game, c.solution as never, c.answer), c.name).toBe(c.score);
    for (const game of VISUAL_TASK_GAMES) {
      expect(
        CASES.some((c) => c.game === game && c.score === 10_000),
        game,
      ).toBe(true);
      expect(
        CASES.some((c) => c.game === game && c.score < 10_000),
        game,
      ).toBe(true);
    }
  });

  it("every new game has tasks in the catalogue and a config", () => {
    for (const game of VISUAL_TASK_GAMES) {
      expect(task(game), game).toBeDefined();
      expect(COMPANY_TASK_RULES.games[game].seconds, game).toBeGreaterThan(0);
    }
  });

  it("tiles: scrambled but solvable; every tile in place counts, an illegal slide scores nothing", () => {
    for (let seed = 1; seed < 15; seed++) {
      const { puzzle, solution } = generatePuzzle(task("tiles"), rngOf(seed));
      const p = puzzle as { size: number; board: number[] };
      expect(p.board.length - 1 - tilesInPlace(p.board)).toBeGreaterThanOrEqual(g.tiles.minWrong);
      const moves = tileMoves(p.size, p.board);
      expect(moves.length).toBeLessThanOrEqual(g.tiles.scramble);
      expect(gradeAnswer("tiles", solution, { moves })).toBe(10_000);
      expect(gradeAnswer("tiles", solution, { moves: [] })).toBe(Math.trunc((tilesInPlace(p.board) * 10_000) / 8));
    }
    const sol = { size: 3, board: [0, 1, 2, 3, 4, 5, 6, -1, 7], max_moves: 400 };
    expect(gradeAnswer("tiles", sol, { moves: [8] })).toBe(10_000);
    expect(gradeAnswer("tiles", sol, { moves: [0] })).toBe(0);
    expect(gradeAnswer("tiles", sol, { moves: [8, 7] })).toBe(8_750);
    expect(gradeAnswer("tiles", sol, { moves: ["8"] })).toBe(0);
    expect(gradeAnswer("tiles", { ...sol, max_moves: 1 }, { moves: [8, 7] })).toBe(0);
  });

  it("bins: by colour or shape; the share of right shelves counts", () => {
    const { puzzle, solution } = generatePuzzle(task("bins"), rngOf(3));
    const p = puzzle as { items: Point[]; by: number };
    const right = p.items.map((it) => it[p.by]!);
    expect(gradeAnswer("bins", solution, { bins: right })).toBe(10_000);
    const sol = { bins: [0, 1, 2, 0] };
    expect(gradeAnswer("bins", sol, { bins: [0, 1, 2, 1] })).toBe(7_500);
    expect(gradeAnswer("bins", sol, { bins: "x" })).toBe(0);
  });

  it("untangle: a layout without crossings exists; every meeting pair costs 20 %", () => {
    for (let seed = 1; seed < 20; seed++) {
      const { puzzle, solution } = generatePuzzle(task("untangle"), rngOf(seed));
      const p = puzzle as { grid: number; edges: Point[]; points: Point[] };
      expect(p.points).toHaveLength(g.untangle.nodes);
      expect(crossings(p.edges, p.points)).toBeGreaterThanOrEqual(g.untangle.minCrossings);
      // the generator swapped the nodes of a layout without crossings: the same points, another order
      const untangled = (solution as { untangled: Point[] }).untangled;
      expect(crossings(p.edges, untangled), `seed ${seed}`).toBe(0);
      expect([...untangled].map(String).sort()).toEqual([...p.points].map(String).sort());
      expect(gradeAnswer("untangle", solution, { points: untangled })).toBe(10_000);
      const c = crossings(p.edges, p.points);
      expect(gradeAnswer("untangle", solution, { points: p.points })).toBe(Math.max(0, 10_000 - c * 2_000));
    }
    const sol = {
      grid: 3,
      edges: [
        [0, 1],
        [2, 3],
      ] as Point[],
      step_bps: 2_000,
      untangled: [] as Point[],
    };
    expect(
      gradeAnswer("untangle", sol, {
        points: [
          [0, 0],
          [2, 2],
          [2, 0],
          [0, 2],
        ],
      }),
    ).toBe(8_000);
    expect(
      gradeAnswer("untangle", sol, {
        points: [
          [0, 0],
          [2, 0],
          [0, 2],
          [2, 2],
        ],
      }),
    ).toBe(10_000);
    // two nodes on one point, off the board, the wrong count
    expect(
      gradeAnswer("untangle", sol, {
        points: [
          [0, 0],
          [0, 0],
          [0, 2],
          [2, 2],
        ],
      }),
    ).toBe(0);
    expect(
      gradeAnswer("untangle", sol, {
        points: [
          [0, 0],
          [3, 0],
          [0, 2],
          [2, 2],
        ],
      }),
    ).toBe(0);
    expect(
      gradeAnswer("untangle", sol, {
        points: [
          [0, 0],
          [2, 0],
          [0, 2],
        ],
      }),
    ).toBe(0);
  });

  it("segmentsMeet: crossing, touching and overlapping count, parallel does not", () => {
    expect(segmentsMeet([0, 0], [2, 2], [0, 2], [2, 0])).toBe(true);
    expect(segmentsMeet([0, 0], [2, 0], [1, 0], [1, 2])).toBe(true);
    expect(segmentsMeet([0, 0], [2, 0], [1, 0], [3, 0])).toBe(true);
    expect(segmentsMeet([0, 0], [2, 0], [0, 1], [2, 1])).toBe(false);
    expect(segmentsMeet([0, 0], [1, 0], [2, 0], [3, 0])).toBe(false);
    expect(segmentsMeet([0, 0], [1, 1], [2, 2], [3, 0])).toBe(false);
  });

  it("odd: one faulty good per round; the share of found ones counts", () => {
    const { puzzle, solution } = generatePuzzle(task("odd"), rngOf(5));
    const p = puzzle as { rounds: number[][] };
    const found = p.rounds.map((cells) => cells.findIndex((v) => v % 4 !== 0));
    for (const cells of p.rounds) expect(cells.filter((v) => v % 4 !== 0)).toHaveLength(1);
    expect(gradeAnswer("odd", solution, { choices: found })).toBe(10_000);
    expect(gradeAnswer("odd", { choices: [1, 2, 3] }, { choices: [1, 2, 0] })).toBe(6_666);
  });

  it("rebuild: every good back on its cell; a good twice scores nothing", () => {
    const { puzzle, solution } = generatePuzzle(task("rebuild"), rngOf(7));
    const p = puzzle as { layout: number[] };
    expect(p.layout.filter((v) => v >= 0)).toHaveLength(g.rebuild.items);
    expect(gradeAnswer("rebuild", solution, { layout: p.layout })).toBe(10_000);
    const sol = { layout: [0, -1, 1, -1, 2, -1, -1, 3, -1] };
    expect(gradeAnswer("rebuild", sol, { layout: [0, 1, -1, -1, 2, -1, -1, 3, -1] })).toBe(7_500);
    expect(gradeAnswer("rebuild", sol, { layout: [0, 0, 1, -1, 2, -1, -1, 3, -1] })).toBe(0);
    expect(gradeAnswer("rebuild", sol, { layout: [0, -1, 1] })).toBe(0);
    expect(gradeAnswer("rebuild", sol, { layout: [9, -1, 1, -1, 2, -1, -1, 3, -1] })).toBe(0);
  });

  it("align: every part has exactly one matching outline", () => {
    const { puzzle, solution } = generatePuzzle(task("align"), rngOf(9));
    const p = puzzle as { slots: number[]; parts: number[] };
    expect(new Set(p.slots).size).toBe(g.align.slots);
    const at = p.parts.map((k) => p.slots.indexOf(k));
    expect(at.every((s) => s >= 0)).toBe(true);
    expect(gradeAnswer("align", solution, { at })).toBe(10_000);
    expect(gradeAnswer("align", { at: [0, 1, 2, 3] }, { at: [0, 1, 3, 2] })).toBe(5_000);
  });

  it("pipes: closed route full marks, open route the right share times half", () => {
    for (let seed = 1; seed < 25; seed++) {
      const { puzzle, solution } = generatePuzzle(task("pipes"), rngOf(seed));
      const p = puzzle as { size: number; tiles: number[]; turns: number[]; from: number; to: number };
      const s = solution as { path: number[]; need: number[] };
      expect(pipesConnected(p.size, p.tiles, p.turns, p.from, p.to), `seed ${seed}`).toBe(false);
      // turn every pipe of the route until it fits
      const turns = [...p.turns];
      s.path.forEach((cell, k) => {
        while (turnMask(p.tiles[cell] === 1 ? 3 : 5, turns[cell]!) !== s.need[k]) turns[cell] = (turns[cell]! + 1) % 4;
      });
      expect(gradeAnswer("pipes", solution, { turns })).toBe(10_000);
      expect(gradeAnswer("pipes", solution, { turns: p.turns })).toBeLessThanOrEqual(5_000);
    }
    expect(turnMask(5, 1)).toBe(10);
    expect(turnMask(3, 1)).toBe(6);
    expect(turnMask(3, 3)).toBe(9);
    // a straight row 1 across a 2 x 2 field
    const { path, need } = pipeRoute(2, [1, 1], 1, 1);
    expect(path).toEqual([2, 3]);
    expect(need).toEqual([10, 10]);
    const sol = { size: 2, tiles: [0, 0, 0, 0], from: 1, to: 1, path, need, open_bps: 5_000 };
    expect(gradeAnswer("pipes", sol, { turns: [0, 0, 1, 1] })).toBe(10_000);
    expect(gradeAnswer("pipes", sol, { turns: [0, 0, 1, 0] })).toBe(2_500);
    expect(gradeAnswer("pipes", sol, { turns: [0, 0, 1, 7] })).toBe(0);
    expect(gradeAnswer("pipes", sol, { turns: [0, 0, 1] })).toBe(0);
  });

  it("sizes: distinct sizes at least minGap apart; every right place counts", () => {
    for (let seed = 1; seed < 15; seed++) {
      const { puzzle, solution } = generatePuzzle(task("sizes"), rngOf(seed));
      const sizes = (puzzle as { sizes: number[] }).sizes;
      const sorted = [...sizes].sort((a, b) => a - b);
      sorted.forEach((v, i) => i > 0 && expect(v - sorted[i - 1]!).toBeGreaterThanOrEqual(g.sizes.minGap));
      const order = sorted.map((v) => sizes.indexOf(v));
      expect(gradeAnswer("sizes", solution, { order })).toBe(10_000);
    }
    expect(gradeAnswer("sizes", { order: [2, 0, 1, 3] }, { order: [0, 2, 1, 3] })).toBe(5_000);
  });

  it("conveyor: right bin +1, wrong bin -1, missed 0", () => {
    const { puzzle, solution } = generatePuzzle(task("conveyor"), rngOf(11));
    const items = (puzzle as { items: number[] }).items;
    expect(items).toHaveLength(g.conveyor.items);
    expect(gradeAnswer("conveyor", solution, { bins: items })).toBe(10_000);
    const sol = { bins: [0, 1, 2, 0], scoring: "net" as const };
    expect(gradeAnswer("conveyor", sol, { bins: [0, 1, 2, -1] })).toBe(7_500);
    expect(gradeAnswer("conveyor", sol, { bins: [0, 1, 0, -1] })).toBe(2_500);
    expect(gradeAnswer("conveyor", sol, { bins: [1, 0, 0, 1] })).toBe(0);
    expect(gradeAnswer("conveyor", sol, { bins: null })).toBe(0);
  });
});
