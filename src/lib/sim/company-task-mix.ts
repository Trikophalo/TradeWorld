/**
 * Which company task comes next (ADR-186): a weighted draw over the tasks a company can get. Mirrors the draw in
 * company_tasks_run_due() (migration 20261204007620), which orders by -ln(1 - random()) / weight; the first of that
 * order is drawn with probability weight / sum of weights, the same as here. Pure: randomness comes in as `rng`.
 */
import { TASK_GAME_KINDS, type CompanyTaskConfig, type TaskGameKind } from "../../config/company-tasks.ts";

type Weighted = Pick<CompanyTaskConfig, "game" | "product" | "weight">;

const weightOf = (t: Weighted) => (typeof t.weight === "number" && t.weight > 0 ? t.weight : 1);

/** One task of the pool, each with probability weight / total; undefined for an empty pool. */
export function pickWeightedTask<T extends Weighted>(pool: readonly T[], rng: () => number): T | undefined {
  const total = pool.reduce((s, t) => s + weightOf(t), 0);
  let x = rng() * total;
  for (const t of pool) {
    x -= weightOf(t);
    if (x < 0) return t;
  }
  return pool[pool.length - 1];
}

/** The tasks a company with this product can get: every generic one and its own. */
export function tasksFor<T extends Weighted>(tasks: readonly T[], product: string): T[] {
  return tasks.filter((t) => t.product === "*" || t.product === product);
}

/** Expected share of each game kind among the drawn tasks of a product, in bps. */
export function taskMix(tasks: readonly Weighted[], product: string): Record<TaskGameKind, number> {
  const pool = tasksFor(tasks, product);
  const total = pool.reduce((s, t) => s + weightOf(t), 0);
  const out: Record<TaskGameKind, number> = { calc: 0, drag: 0, visual: 0 };
  for (const t of pool) out[TASK_GAME_KINDS[t.game]] += weightOf(t);
  for (const k of Object.keys(out) as TaskGameKind[]) out[k] = Math.round((out[k] * 10_000) / Math.max(total, 1));
  return out;
}
