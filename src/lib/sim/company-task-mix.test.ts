import { describe, expect, it } from "vitest";
import {
  COMPANY_TASK_RULES,
  COMPANY_TASKS,
  TASK_GAME_KINDS,
  TASK_GAMES,
  taskWeight,
} from "../../config/company-tasks.ts";
import { pickWeightedTask, taskMix, tasksFor } from "./company-task-mix.ts";
import { createRng } from "./rng.ts";

const products = [...new Set(COMPANY_TASKS.map((t) => t.product).filter((p) => p !== "*"))];
const mix = COMPANY_TASK_RULES.mix;

describe("company task mix (ADR-186)", () => {
  it("every game has a kind and every task its weight", () => {
    for (const game of TASK_GAMES) expect(TASK_GAME_KINDS[game], game).toBeDefined();
    for (const t of COMPANY_TASKS) expect(t.weight, t.key).toBe(taskWeight(t));
    expect(taskWeight({ game: "math", product: "*" })).toBe(mix.kindWeight.calc * mix.genericWeight);
    expect(taskWeight({ game: "tiles", product: "fintech" })).toBe(mix.kindWeight.drag * mix.productWeight);
  });

  it("maths and typing come up at most 20 % for every product, drag and see games the rest", () => {
    for (const p of products) {
      const m = taskMix(COMPANY_TASKS, p);
      expect(m.calc, p).toBeLessThanOrEqual(mix.maxCalcShareBps);
      expect(m.drag + m.visual, p).toBeGreaterThanOrEqual(8_000);
      // drag games are the biggest group
      expect(m.drag, p).toBeGreaterThan(m.visual);
    }
    expect(mix.maxCalcShareBps).toBeLessThanOrEqual(2_000);
  });

  it("calc tasks stay in the catalogue (fewer, not gone)", () => {
    const calc = COMPANY_TASKS.filter((t) => TASK_GAME_KINDS[t.game] === "calc");
    expect(calc.length).toBeGreaterThan(40);
    for (const p of products) expect(taskMix(COMPANY_TASKS, p).calc, p).toBeGreaterThan(0);
  });

  it("every product has at least one new drag or see task of its own", () => {
    const fresh = ["tiles", "bins", "untangle", "odd", "rebuild", "align", "pipes", "sizes", "conveyor"];
    for (const p of products)
      expect(
        COMPANY_TASKS.some((t) => t.product === p && fresh.includes(t.game)),
        p,
      ).toBe(true);
  });

  it("the weighted draw hits each task with weight / total", () => {
    const pool = tasksFor(COMPANY_TASKS, "fintech");
    const total = pool.reduce((s, t) => s + t.weight!, 0);
    const r = createRng(42);
    const hits = new Map<string, number>();
    const n = 60_000;
    for (let i = 0; i < n; i++) {
      const t = pickWeightedTask(pool, () => r.next())!;
      hits.set(t.key, (hits.get(t.key) ?? 0) + 1);
    }
    for (const t of pool) expect(Math.abs((hits.get(t.key) ?? 0) / n - t.weight! / total), t.key).toBeLessThan(0.006);
    let calc = 0;
    for (const t of pool) if (TASK_GAME_KINDS[t.game] === "calc") calc += hits.get(t.key) ?? 0;
    expect(calc / n).toBeLessThan(0.2);
    expect(pickWeightedTask([], () => 0.5)).toBeUndefined();
    expect(pickWeightedTask([{ game: "math", product: "*" }], () => 0.99)).toBeDefined();
  });
});
