/**
 * Company task games (ADR-129, ADR-144): puzzles and grading. Mirrors company_task_puzzle() and company_task_grade()
 * in supabase/migrations/20261204001600_task_games.sql; the server is the authority, this runs the demo.
 * Pure: randomness comes in as `rng` (0 ≤ x < 1).
 */
import type { CompanyTaskConfig } from "../../config/company-tasks.ts";
import { COMPANY_TASK_RULES } from "../../config/company-tasks.ts";
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
  | { size: number; start: number; goal: number; walls: number[] };

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
  | PathSolution;

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
  | { path: number[] };

type Rules = typeof COMPANY_TASK_RULES;

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
  switch (task.game) {
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
  }
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
  switch (game) {
    case "pick": {
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
    default: {
      const key = game === "sort" ? "sides" : game === "order" ? "order" : game === "match" ? "boxes" : "sequence";
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
