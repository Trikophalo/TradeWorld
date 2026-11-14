/**
 * Company task games (ADR-129): puzzles and grading. Mirrors company_task_puzzle() and company_task_grade() in
 * supabase/migrations/20261204000100_company_tasks.sql; the server is the authority, this runs the demo.
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
  | { a: number; b: number };

export type TaskSolution =
  | { targets: number[] }
  | { count: number }
  | { sides: number[] }
  | { order: number[] }
  | { sequence: number[] }
  | { value: number };

export type TaskAnswer =
  | { picked: number[] }
  | { count: number }
  | { sides: number[] }
  | { order: number[] }
  | { sequence: number[] }
  | { value: number };

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
      while (values.length < g.order.items) {
        const v = between(rng, g.order.min, g.order.max);
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
  }
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
    default: {
      const key = game === "sort" ? "sides" : game === "order" ? "order" : "sequence";
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
