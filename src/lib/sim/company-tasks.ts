/**
 * Company task games (ADR-129, ADR-144, ADR-173; ADR-180 and ADR-186 in their own files): puzzles and grading. Mirrors company_task_puzzle() and
 * company_task_grade() in supabase/migrations/20261204006400_task_games_more.sql; the server is the authority, this
 * runs the demo.
 * Pure: randomness comes in as `rng` (0 ≤ x < 1).
 */
import type { CompanyTaskConfig } from "../../config/company-tasks.ts";
import { COMPANY_TASK_RULES } from "../../config/company-tasks.ts";
import { generateMore, gradeMore, type MorePuzzle, type MoreSolution } from "./company-tasks-more.ts";
import {
  generateVisual,
  gradeVisual,
  VISUAL_TASK_GAMES,
  type VisualPuzzle,
  type VisualSolution,
  type VisualTaskGame,
} from "./company-tasks-visual.ts";
import { discountedCents, withBonusCents } from "./upgrades.ts";

export type TaskPuzzle =
  | { tiles: number[] }
  | { items: number[] }
  | { values: number[] }
  | { sequence: number[]; show_seconds: number }
  | { a: number; b: number }
  | { targets: number[] }
  | { start: number[]; target: number[]; steps: number }
  | { items: number[]; boxes: number }
  | { size: number; start: number; goal: number; walls: number[] }
  | { cards: number[] }
  | { targets: number[]; sweep_ms: number }
  | { left: number[]; right: number[] }
  | { problems: QuickProblem[] }
  | { points: [number, number][] }
  | { rounds: number[][] }
  | { weights: number[]; values: number[]; cap: number }
  | { events: CatchEvent[]; every_ms: number; show_ms: number }
  | MorePuzzle
  | VisualPuzzle;

/** quick (ADR-173): one sum and its answers to choose from. */
export interface QuickProblem {
  a: number;
  b: number;
  op: NonNullable<CompanyTaskConfig["op"]>;
  options: number[];
}

/** catch (ADR-173): a tile that pops up on a field; good ones are to be tapped. */
export interface CatchEvent {
  cell: number;
  good: boolean;
}

export type TaskSolution =
  | { targets: number[] }
  | { count: number }
  | { sides: number[] }
  | { order: number[] }
  | { sequence: number[] }
  | { value: number }
  | { positions: number[]; tolerance: number }
  | { dials: number[]; steps: number }
  | { boxes: number[] }
  | PathSolution
  | { cards: number[]; miss_bps: number }
  | { stops: number[]; tolerance: number }
  | { choices: number[] }
  | { points: [number, number][]; best: number; step_bps: number }
  | { rounds: number[][]; ok_bps: number }
  | { weights: number[]; values: number[]; cap: number; best: number }
  | MoreSolution
  | VisualSolution;

/** path (ADR-144): the grid again, so grading needs nothing but the solution. */
export interface PathSolution {
  size: number;
  start: number;
  goal: number;
  walls: number[];
  /** Moves of the shortest route. */
  length: number;
  step_bps: number;
}

export type TaskAnswer =
  | { picked: number[] }
  | { count: number }
  | { sides: number[] }
  | { order: number[] }
  | { sequence: number[] }
  | { value: number }
  | { positions: number[] }
  | { dials: number[] }
  | { boxes: number[] }
  | { path: number[] }
  | { pairs: [number, number][]; misses: number }
  | { stops: number[] }
  | { choices: number[] }
  | { values: number[] }
  | { grid: number[] }
  | { moves: number[] }
  | { bins: number[] }
  | { points: [number, number][] }
  | { layout: number[] }
  | { at: number[] }
  | { turns: number[] };

type Rules = typeof COMPANY_TASK_RULES;

const isVisual = (game: string): game is VisualTaskGame => (VISUAL_TASK_GAMES as readonly string[]).includes(game);

const between = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

function shuffled<T>(list: readonly T[], rng: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function generatePuzzle(
  task: CompanyTaskConfig,
  rng: () => number,
  rules: Rules = COMPANY_TASK_RULES,
): { puzzle: TaskPuzzle; solution: TaskSolution } {
  const g = rules.games;
  if (isVisual(task.game)) return generateVisual(task.game, rng, rules);
  switch (task.game) {
    case "restock":
    case "receipts":
    case "offer":
    case "pattern":
    case "shelf":
      return generateMore(task.game, rng, rules);
    case "pick":
    case "count": {
      const cfg = g[task.game];
      const n = between(rng, cfg.minTargets, cfg.maxTargets);
      const labels = Array.from({ length: cfg.tiles }, (_, i) => (i < n ? 0 : 1 + Math.floor(rng() * 2)));
      const tiles = shuffled(labels, rng);
      if (task.game === "count") return { puzzle: { tiles }, solution: { count: n } };
      return {
        puzzle: { tiles },
        solution: { targets: tiles.flatMap((label, i) => (label === 0 ? [i] : [])) },
      };
    }
    case "sort": {
      const items = shuffled(
        Array.from({ length: g.sort.items }, (_, i) => i),
        rng,
      );
      return { puzzle: { items }, solution: { sides: items.map((i) => (i < g.sort.items / 2 ? 0 : 1)) } };
    }
    case "order": {
      const values: number[] = [];
      const [lo, hi] = task.range ?? [g.order.min, g.order.max];
      while (values.length < g.order.items) {
        const v = between(rng, lo, hi);
        if (!values.includes(v)) values.push(v);
      }
      const asc = task.asc ?? true;
      const order = values
        .map((v, i) => ({ v, i }))
        .sort((x, y) => (asc ? x.v - y.v : y.v - x.v))
        .map((x) => x.i);
      return { puzzle: { values }, solution: { order } };
    }
    case "seq": {
      const sequence = Array.from({ length: g.seq.length }, () => Math.floor(rng() * 4));
      return { puzzle: { sequence, show_seconds: g.seq.showSeconds }, solution: { sequence } };
    }
    case "math": {
      const { a, b } = mathOperands(task, rng);
      return { puzzle: { a, b }, solution: { value: mathValue(task.op ?? "add", a, b) } };
    }
    case "slider": {
      const c = g.slider;
      const targets = Array.from({ length: c.sliders }, () => between(rng, c.min, c.max));
      return { puzzle: { targets }, solution: { positions: targets, tolerance: c.tolerance } };
    }
    case "rotate": {
      const c = g.rotate;
      const target: number[] = [];
      const start: number[] = [];
      for (let i = 0; i < c.dials; i++) {
        const t = between(rng, 0, c.steps - 1);
        // turned away by minTurn .. steps - minTurn steps, so no dial starts (almost) right
        const off = between(rng, c.minTurn, c.steps - c.minTurn);
        target.push(t);
        start.push((t + off) % c.steps);
      }
      return { puzzle: { start, target, steps: c.steps }, solution: { dials: target, steps: c.steps } };
    }
    case "match": {
      const c = g.match;
      const chosen: number[] = [];
      for (let box = 0; box < c.boxes; box++) {
        const group = shuffled(
          Array.from({ length: c.groupSize }, (_, k) => box * c.groupSize + k),
          rng,
        );
        chosen.push(...group.slice(0, c.perBox));
      }
      const items = shuffled(chosen, rng);
      return {
        puzzle: { items, boxes: c.boxes },
        solution: { boxes: items.map((i) => Math.floor(i / c.groupSize)) },
      };
    }
    case "path": {
      const c = g.path;
      const n = c.size * c.size;
      for (let attempt = 0; attempt < 60; attempt++) {
        const start = between(rng, 0, c.size - 1) * c.size;
        const goal = between(rng, 0, c.size - 1) * c.size + c.size - 1;
        const count = between(rng, c.minWalls, c.maxWalls);
        const free = shuffled(
          Array.from({ length: n }, (_, i) => i).filter((i) => i !== start && i !== goal),
          rng,
        );
        const walls = free.slice(0, count).sort((x, y) => x - y);
        const length = shortestPath(c.size, start, goal, walls);
        if (length !== null && length >= manhattan(c.size, start, goal) + c.minDetour) {
          return pathPuzzle(c.size, start, goal, walls, length, c.stepBps);
        }
      }
      // fallback: a wall across the middle column
      const mid = Math.floor(c.size / 2);
      const start = mid * c.size;
      const goal = mid * c.size + c.size - 1;
      const walls = Array.from({ length: c.size - 2 }, (_, k) => (k + 1) * c.size + mid);
      return pathPuzzle(c.size, start, goal, walls, shortestPath(c.size, start, goal, walls) ?? 0, c.stepBps);
    }
    case "memory": {
      const c = g.memory;
      const cards = shuffled(
        Array.from({ length: c.pairs * 2 }, (_, i) => Math.floor(i / 2)),
        rng,
      );
      return { puzzle: { cards }, solution: { cards, miss_bps: c.missBps } };
    }
    case "timing": {
      const c = g.timing;
      const targets = Array.from({ length: c.rounds }, () => between(rng, c.min, c.max));
      return { puzzle: { targets, sweep_ms: c.sweepMs }, solution: { stops: targets, tolerance: c.tolerance } };
    }
    case "diff": {
      const c = g.diff;
      const left = Array.from({ length: c.cells }, () => between(rng, 0, c.symbols - 1));
      const n = between(rng, c.minDiffs, c.maxDiffs);
      const cells = shuffled(
        Array.from({ length: c.cells }, (_, i) => i),
        rng,
      )
        .slice(0, n)
        .sort((x, y) => x - y);
      const right = left.map((label, i) =>
        cells.includes(i) ? (label + 1 + between(rng, 0, c.symbols - 2)) % c.symbols : label,
      );
      return { puzzle: { left, right }, solution: { targets: cells } };
    }
    case "quick": {
      const c = g.quick;
      const problems: QuickProblem[] = [];
      const choices: number[] = [];
      const op = task.op ?? "add";
      for (let k = 0; k < c.problems; k++) {
        const { a, b } = mathOperands(task, rng);
        const v = mathValue(op, a, b);
        const d = Math.max(1, Math.floor(Math.abs(v) / 10));
        const up = v + d * between(rng, 1, 3);
        const down = v - d * between(rng, 1, 3);
        const options = shuffled([v, up, down].slice(0, c.options), rng);
        problems.push({ a, b, op, options });
        choices.push(options.indexOf(v));
      }
      return { puzzle: { problems }, solution: { choices } };
    }
    case "route": {
      const c = g.route;
      const cells = shuffled(
        Array.from({ length: c.grid * c.grid }, (_, i) => i),
        rng,
      ).slice(0, c.stops + 1);
      const points = cells.map((cell) => [cell % c.grid, Math.floor(cell / c.grid)] as [number, number]);
      return { puzzle: { points }, solution: { points, best: bestTour(points), step_bps: c.stepBps } };
    }
    case "haggle": {
      const c = g.haggle;
      const rounds = Array.from({ length: c.rounds }, () => shuffled([0, 1, 2], rng));
      return { puzzle: { rounds }, solution: { rounds, ok_bps: c.okBps } };
    }
    case "pack": {
      const c = g.pack;
      const weights = Array.from({ length: c.items }, () => between(rng, c.minWeight, c.maxWeight));
      const values = Array.from({ length: c.items }, () => between(rng, c.minValue, c.maxValue));
      const total = weights.reduce((x, y) => x + y, 0);
      const cap = Math.max(c.maxWeight, Math.trunc((total * c.capShareBps) / 10_000));
      return {
        puzzle: { weights, values, cap },
        solution: { weights, values, cap, best: bestPack(weights, values, cap) },
      };
    }
    case "catch": {
      const c = g.catch;
      const events: CatchEvent[] = [];
      for (let k = 0; k < c.events; k++) {
        let cell = between(rng, 0, c.cells - 1);
        // never twice on the same field in a row, or the second one could not be told apart
        if (k > 0 && cell === events[k - 1]!.cell) cell = (cell + 1) % c.cells;
        events.push({ cell, good: rng() * 10_000 < c.goodShareBps });
      }
      // at least two good ones, so there is something to catch
      for (let k = 0; events.filter((e) => e.good).length < 2 && k < events.length; k++) events[k]!.good = true;
      return {
        puzzle: { events, every_ms: c.everyMs, show_ms: c.showMs },
        solution: { targets: events.flatMap((e, i) => (e.good ? [i] : [])) },
      };
    }
  }
}

/** Operands of a sum (math, quick): the task's ranges; percentages rounded so the result is whole. */
function mathOperands(task: CompanyTaskConfig, rng: () => number): { a: number; b: number } {
  const [a0, a1] = task.a ?? [1, 10];
  const [b0, b1] = task.b ?? [1, 10];
  let a = between(rng, a0, a1);
  let b = between(rng, b0, b1);
  if (task.op === "pct") {
    if (a1 >= 1000) a = Math.max(100, Math.floor(a / 100) * 100);
    else {
      a = Math.max(10, Math.floor(a / 10) * 10);
      b = Math.max(10, Math.floor(b / 10) * 10);
    }
  }
  return { a, b };
}

const dist = (p: readonly [number, number], q: readonly [number, number]) =>
  Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);

/** Fields of a round trip from the depot (points[0]) through the stops in `order` (indices ≥ 1) and back. */
export function tourLength(points: readonly (readonly [number, number])[], order: readonly number[]): number {
  let at = points[0]!;
  let sum = 0;
  for (const i of order) {
    sum += dist(at, points[i]!);
    at = points[i]!;
  }
  return sum + dist(at, points[0]!);
}

/** The shortest round trip over all orders of the stops (four stops: 24 orders). */
export function bestTour(points: readonly (readonly [number, number])[]): number {
  let best = Number.POSITIVE_INFINITY;
  const walk = (rest: number[], done: number[]) => {
    if (rest.length === 0) {
      best = Math.min(best, tourLength(points, done));
      return;
    }
    rest.forEach((x, i) => walk([...rest.slice(0, i), ...rest.slice(i + 1)], [...done, x]));
  };
  walk(
    Array.from({ length: points.length - 1 }, (_, i) => i + 1),
    [],
  );
  return best;
}

/** The most value that fits into the capacity (every subset; six items: 64). */
export function bestPack(weights: readonly number[], values: readonly number[], cap: number): number {
  let best = 0;
  for (let mask = 0; mask < 1 << weights.length; mask++) {
    let w = 0;
    let v = 0;
    for (let i = 0; i < weights.length; i++) {
      if (mask & (1 << i)) {
        w += weights[i]!;
        v += values[i]!;
      }
    }
    if (w <= cap) best = Math.max(best, v);
  }
  return best;
}

const isIndex = (x: unknown, n: number): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && x < n;

/** memory: found pairs (each card once, both the same) minus the wrong flips. */
function gradeMemory(sol: { cards: number[]; miss_bps: number }, pairs: unknown, misses: unknown): number {
  if (!Array.isArray(pairs)) return 0;
  const used = new Set<number>();
  let found = 0;
  for (const pair of pairs as unknown[]) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [i, j] = pair as unknown[];
    if (!isIndex(i, sol.cards.length) || !isIndex(j, sol.cards.length) || i === j) continue;
    if (used.has(i) || used.has(j) || sol.cards[i] !== sol.cards[j]) continue;
    used.add(i);
    used.add(j);
    found += 1;
  }
  const wrong = typeof misses === "number" && Number.isInteger(misses) && misses > 0 ? misses : 0;
  const score = Math.trunc((found * 10_000) / Math.max(sol.cards.length / 2, 1)) - wrong * sol.miss_bps;
  return Math.max(0, Math.min(10_000, score));
}

/** route: a full order of the stops; every field more than the best round trip costs step_bps. */
function gradeRoute(sol: { points: [number, number][]; best: number; step_bps: number }, order: unknown): number {
  const n = sol.points.length - 1;
  if (!Array.isArray(order) || order.length !== n) return 0;
  const list = order as unknown[];
  if (!list.every((x) => typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= n)) return 0;
  if (new Set(list).size !== n) return 0;
  const extra = tourLength(sol.points, list as number[]) - sol.best;
  return Math.max(0, Math.min(10_000, 10_000 - extra * sol.step_bps));
}

/** haggle: per round the rank of the chosen reply (0 best, 1 middle, 2 bad); the average counts. */
function gradeHaggle(sol: { rounds: number[][]; ok_bps: number }, choices: unknown): number {
  if (!Array.isArray(choices)) return 0;
  const parts = sol.rounds.map((perm, r) => {
    const c = (choices as unknown[])[r];
    if (!isIndex(c, perm.length)) return 0;
    const rank = perm[c];
    return rank === 0 ? 10_000 : rank === 1 ? sol.ok_bps : 0;
  });
  return Math.trunc(parts.reduce((a, b) => a + b, 0) / Math.max(sol.rounds.length, 1));
}

/** pack: the loaded value against the best load; over the capacity nothing. */
function gradePack(sol: { weights: number[]; values: number[]; cap: number; best: number }, picked: unknown): number {
  if (!Array.isArray(picked)) return 0;
  const list = picked as unknown[];
  if (!list.every((x) => isIndex(x, sol.weights.length)) || new Set(list).size !== list.length) return 0;
  const idx = list as number[];
  const weight = idx.reduce((sum, i) => sum + sol.weights[i]!, 0);
  if (weight > sol.cap) return 0;
  const value = idx.reduce((sum, i) => sum + sol.values[i]!, 0);
  return Math.max(0, Math.min(10_000, Math.trunc((value * 10_000) / Math.max(sol.best, 1))));
}

function pathPuzzle(size: number, start: number, goal: number, walls: number[], length: number, stepBps: number) {
  return {
    puzzle: { size, start, goal, walls },
    solution: { size, start, goal, walls, length, step_bps: stepBps },
  };
}

const manhattan = (size: number, a: number, b: number) =>
  Math.abs(Math.floor(a / size) - Math.floor(b / size)) + Math.abs((a % size) - (b % size));

/** Moves of the shortest route from start to goal around the walls, null if there is none. */
export function shortestPath(size: number, start: number, goal: number, walls: readonly number[]): number | null {
  const route = shortestRoute(size, start, goal, walls);
  return route ? route.length - 1 : null;
}

/** One shortest route (cells from start to goal) around the walls, breadth-first; null if there is none. */
export function shortestRoute(size: number, start: number, goal: number, walls: readonly number[]): number[] | null {
  const prev = new Array<number>(size * size).fill(-2);
  prev[start] = -1;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    if (cell === goal) {
      const route = [cell];
      while (prev[route[0]!]! >= 0) route.unshift(prev[route[0]!]!);
      return route;
    }
    const r = Math.floor(cell / size);
    const col = cell % size;
    const next = [
      r > 0 ? cell - size : -1,
      r < size - 1 ? cell + size : -1,
      col > 0 ? cell - 1 : -1,
      col < size - 1 ? cell + 1 : -1,
    ];
    for (const nb of next) {
      if (nb >= 0 && prev[nb] === -2 && !walls.includes(nb)) {
        prev[nb] = cell;
        queue.push(nb);
      }
    }
  }
  return null;
}

/** Score of a drawn route: 0 unless it runs from start to goal in single steps, around walls, no cell twice. */
function gradePath(sol: PathSolution, path: unknown): number {
  if (!Array.isArray(path) || path.length < 2) return 0;
  const cells = path as unknown[];
  if (!cells.every((c) => typeof c === "number" && Number.isInteger(c) && c >= 0 && c < sol.size * sol.size)) return 0;
  const route = cells as number[];
  if (route[0] !== sol.start || route[route.length - 1] !== sol.goal) return 0;
  if (new Set(route).size !== route.length || route.some((c) => sol.walls.includes(c))) return 0;
  for (let i = 1; i < route.length; i++) if (manhattan(sol.size, route[i - 1]!, route[i]!) !== 1) return 0;
  const extra = route.length - 1 - sol.length;
  return Math.max(0, Math.min(10_000, 10_000 - extra * sol.step_bps));
}

/** Average of the parts: exact full marks, close (within `near`) half, else nothing. */
function gradeParts(
  want: number[],
  got: unknown,
  near: { exact: number; half: number },
  diff: (a: number, b: number) => number,
): number {
  if (!Array.isArray(got)) return 0;
  const parts = want.map((w, i) => {
    const v = (got as unknown[])[i];
    if (typeof v !== "number" || !Number.isFinite(v)) return 0;
    const d = diff(v, w);
    return d <= near.exact ? 10_000 : d <= near.half ? 5_000 : 0;
  });
  return Math.trunc(parts.reduce<number>((a, b) => a + b, 0) / Math.max(want.length, 1));
}

export function mathValue(op: NonNullable<CompanyTaskConfig["op"]>, a: number, b: number): number {
  switch (op) {
    case "mul":
      return a * b;
    case "add":
      return a + b;
    case "sub":
      return a - b;
    case "pct":
      return Math.trunc((a * b) / 100);
  }
}

/** Score in basis points (0..10000), same rules as the server. */
export function gradeAnswer(game: CompanyTaskConfig["game"], solution: TaskSolution, answer: unknown): number {
  if (!answer || typeof answer !== "object") return 0;
  const ans = answer as Record<string, unknown>;
  const sol = solution as Record<string, unknown>;
  if (isVisual(game)) return gradeVisual(game, solution as VisualSolution, answer);
  switch (game) {
    case "restock":
    case "receipts":
    case "offer":
    case "pattern":
    case "shelf":
      return gradeMore(game, solution as MoreSolution, answer);
    case "pick":
    case "diff":
    case "catch": {
      const targets = sol.targets as number[];
      if (!Array.isArray(ans.picked)) return 0;
      const picked = [...new Set(ans.picked as number[])];
      const hits = picked.filter((p) => targets.includes(p)).length;
      const wrong = picked.length - hits;
      return Math.max(0, Math.min(10_000, Math.trunc(((hits - wrong) * 10_000) / Math.max(targets.length, 1))));
    }
    case "count":
    case "math": {
      const key = game === "count" ? "count" : "value";
      if (typeof ans[key] !== "number") return 0;
      const diff = Math.abs((ans[key] as number) - (sol[key] as number));
      return diff === 0 ? 10_000 : game === "count" && diff === 1 ? 5_000 : 0;
    }
    case "slider": {
      const tol = Number(sol.tolerance);
      return gradeParts(sol.positions as number[], ans.positions, { exact: tol, half: 3 * tol }, (a, b) =>
        Math.abs(a - b),
      );
    }
    case "rotate": {
      const steps = Number(sol.steps);
      return gradeParts(sol.dials as number[], ans.dials, { exact: 0, half: 1 }, (a, b) => {
        const d = Math.abs(a - b) % steps;
        return Math.min(d, steps - d);
      });
    }
    case "path":
      return gradePath(solution as PathSolution, ans.path);
    case "timing": {
      const tol = Number(sol.tolerance);
      return gradeParts(sol.stops as number[], ans.stops, { exact: tol, half: 3 * tol }, (a, b) => Math.abs(a - b));
    }
    case "memory":
      return gradeMemory(solution as { cards: number[]; miss_bps: number }, ans.pairs, ans.misses);
    case "route":
      return gradeRoute(solution as { points: [number, number][]; best: number; step_bps: number }, ans.order);
    case "haggle":
      return gradeHaggle(solution as { rounds: number[][]; ok_bps: number }, ans.choices);
    case "pack":
      return gradePack(solution as { weights: number[]; values: number[]; cap: number; best: number }, ans.picked);
    default: {
      const key =
        game === "sort"
          ? "sides"
          : game === "order"
            ? "order"
            : game === "match"
              ? "boxes"
              : game === "quick"
                ? "choices"
                : "sequence";
      const want = sol[key] as number[];
      if (!Array.isArray(ans[key])) return 0;
      const got = ans[key] as unknown[];
      const hits = want.filter((v, i) => got[i] === v).length;
      return Math.trunc((hits * 10_000) / Math.max(want.length, 1));
    }
  }
}

/** The founder's company task upgrades (ADR-134) in bps: task_pay, task_safety. */
export interface TaskUpgradeBps {
  readonly payBonusBps?: number;
  readonly penaltyDiscountBps?: number;
}

/**
 * Money of a finished task: success pays value × score (× AI share) plus task_pay, failure costs value × penalty
 * less task_safety (ADR-134; the bonus and the discount rounded half even like apply_bps).
 */
export function taskResultCents(
  valueCents: number,
  scoreBps: number | null,
  byAi: boolean,
  rules: Rules = COMPANY_TASK_RULES,
  upgrades: TaskUpgradeBps = {},
): number {
  if (scoreBps !== null && scoreBps >= rules.passScoreBps) {
    const earned = Math.trunc((valueCents * scoreBps) / 10_000);
    const base = byAi ? Math.trunc((earned * rules.ai.valueBps) / 10_000) : earned;
    return Number(withBonusCents(BigInt(base), upgrades.payBonusBps ?? 0));
  }
  const penalty = Math.trunc((valueCents * rules.penaltyBps) / 10_000);
  return -Number(discountedCents(BigInt(penalty), upgrades.penaltyDiscountBps ?? 0));
}

/** Minutes the AI needs when it already works on `queued` tasks; ai_turbo (ADR-134) takes `timeDiscountBps` off. */
export function aiMinutes(queued: number, rules: Rules = COMPANY_TASK_RULES, timeDiscountBps = 0): number {
  const minutes =
    (rules.ai.minutes * (10_000 + queued * rules.ai.slowdownPerQueuedBps) * (10_000 - timeDiscountBps)) /
    10_000 /
    10_000;
  return Math.max(1, Math.ceil(minutes));
}
