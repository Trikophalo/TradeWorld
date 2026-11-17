/**
 * Five more company task games (ADR-180): restock, receipts, offer, pattern and shelf. Puzzles and grading, mirrored
 * in company_task_puzzle_more() and company_task_grade_more() (migration 20261204006920). The server is the
 * authority; this runs the demo and the tests. Pure: randomness comes in as `rng` (0 <= x < 1).
 */
import type { COMPANY_TASK_RULES } from "../../config/company-tasks.ts";

type Rules = typeof COMPANY_TASK_RULES;

export const MORE_TASK_GAMES = ["restock", "receipts", "offer", "pattern", "shelf"] as const;
export type MoreTaskGame = (typeof MORE_TASK_GAMES)[number];

export type MorePuzzle =
  | { stock: number[]; target: number[] }
  | { amounts: number[]; target: number }
  | { offers: [number, number][][] }
  | { rows: { seq: number[]; options: number[] }[] }
  | { grid: number[] };

export type MoreSolution =
  | { values: number[] }
  | { amounts: number[]; target: number; step_bps: number; picked: number[] }
  | { choices: number[] }
  | { grid: number[]; blanks: number[] };

const between = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

function shuffled<T>(list: readonly T[], rng: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The solved shelf before the symbols are shuffled: a valid 4 x 4 grid (rows, columns, 2 x 2 boxes). */
export function shelfBase(): number[] {
  return Array.from({ length: 16 }, (_, i) => {
    const r = Math.floor(i / 4);
    const c = i % 4;
    return (c + 2 * (r % 2) + Math.floor(r / 2)) % 4;
  });
}

/** The next number of a pattern row: kind 0 adds k, kind 1 doubles, kind 2 adds k, k+1, k+2, ... */
export function patternRow(kind: number, start: number, k: number, length: number): number[] {
  const out = [start];
  for (let i = 1; i < length; i++) {
    const prev = out[i - 1]!;
    out.push(kind === 1 ? prev * 2 : kind === 2 ? prev + k + (i - 1) : prev + k);
  }
  return out;
}

/** Revenue of an offer (price x quantity). */
const revenue = (o: readonly [number, number]) => o[0] * o[1];

export function generateMore(
  game: MoreTaskGame,
  rng: () => number,
  rules: Rules,
): { puzzle: MorePuzzle; solution: MoreSolution } {
  const g = rules.games;
  switch (game) {
    case "restock": {
      const c = g.restock;
      const target = Array.from({ length: c.items }, () => between(rng, c.minTarget, c.maxTarget));
      const stock = target.map((t) => between(rng, 0, t - 2));
      return { puzzle: { stock, target }, solution: { values: target.map((t, i) => t - stock[i]!) } };
    }
    case "receipts": {
      const c = g.receipts;
      const amounts = Array.from({ length: c.items }, () => between(rng, c.min, c.max));
      const picked = shuffled(
        Array.from({ length: c.items }, (_, i) => i),
        rng,
      ).slice(0, c.pick);
      const target = picked.reduce((sum, i) => sum + amounts[i]!, 0);
      return {
        puzzle: { amounts, target },
        solution: { amounts, target, step_bps: c.stepBps, picked: [...picked].sort((x, y) => x - y) },
      };
    }
    case "offer": {
      const c = g.offer;
      const offers: [number, number][][] = [];
      const choices: number[] = [];
      for (let r = 0; r < c.rounds; r++) {
        let round: [number, number][] = [];
        for (let attempt = 0; attempt < 20; attempt++) {
          round = Array.from(
            { length: c.options },
            () => [between(rng, c.minPrice, c.maxPrice), between(rng, c.minQty, c.maxQty)] as [number, number],
          );
          const best = Math.max(...round.map(revenue));
          if (round.filter((o) => revenue(o) === best).length === 1) break;
        }
        // still a tie after 20 tries: one more unit for the first best one makes it unique
        const best = Math.max(...round.map(revenue));
        if (round.filter((o) => revenue(o) === best).length > 1) {
          const i = round.findIndex((o) => revenue(o) === best);
          round[i] = [round[i]![0], round[i]![1] + 1];
        }
        const top = Math.max(...round.map(revenue));
        offers.push(round);
        choices.push(round.findIndex((o) => revenue(o) === top));
      }
      return { puzzle: { offers }, solution: { choices } };
    }
    case "pattern": {
      const c = g.pattern;
      const rows: { seq: number[]; options: number[] }[] = [];
      const choices: number[] = [];
      for (let r = 0; r < c.rounds; r++) {
        const kind = between(rng, 0, 2);
        const start = kind === 1 ? between(rng, 1, 6) : between(rng, 1, 20);
        const k = kind === 2 ? between(rng, 1, 4) : between(rng, 2, 9);
        const full = patternRow(kind, start, k, c.shown + 1);
        const v = full[c.shown]!;
        const d = Math.max(2, Math.floor(v / 10)) * between(rng, 1, 2);
        const options = shuffled([v, v + d, v - d], rng);
        rows.push({ seq: full.slice(0, c.shown), options });
        choices.push(options.indexOf(v));
      }
      return { puzzle: { rows }, solution: { choices } };
    }
    case "shelf": {
      const c = g.shelf;
      const symbols = shuffled([0, 1, 2, 3], rng);
      const grid = shelfBase().map((v) => symbols[v]!);
      const blanks = shuffled(
        Array.from({ length: 16 }, (_, i) => i),
        rng,
      )
        .slice(0, c.blanks)
        .sort((x, y) => x - y);
      return {
        puzzle: { grid: grid.map((v, i) => (blanks.includes(i) ? -1 : v)) },
        solution: { grid, blanks },
      };
    }
  }
}

const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);

/** Score in bps (0..10 000), same rules as the server. */
export function gradeMore(game: MoreTaskGame, solution: MoreSolution, answer: unknown): number {
  if (!answer || typeof answer !== "object") return 0;
  const ans = answer as Record<string, unknown>;
  switch (game) {
    case "restock": {
      // per item the amount to order: exact full marks, one off half
      const want = (solution as { values: number[] }).values;
      if (!Array.isArray(ans.values)) return 0;
      const got = ans.values as unknown[];
      const parts = want.map((w, i): number => {
        const v = got[i];
        if (!isInt(v)) return 0;
        const d = Math.abs(v - w);
        return d === 0 ? 10_000 : d === 1 ? 5_000 : 0;
      });
      return Math.trunc(parts.reduce((a, b) => a + b, 0) / Math.max(want.length, 1));
    }
    case "receipts": {
      // the picked receipts must add up to the target; every euro off costs step_bps
      const sol = solution as { amounts: number[]; target: number; step_bps: number };
      if (!Array.isArray(ans.picked)) return 0;
      const list = ans.picked as unknown[];
      if (!list.every((x) => isInt(x) && x >= 0 && x < sol.amounts.length)) return 0;
      if (new Set(list).size !== list.length || list.length === 0) return 0;
      const sum = (list as number[]).reduce((s, i) => s + sol.amounts[i]!, 0);
      return Math.max(0, Math.min(10_000, 10_000 - Math.abs(sum - sol.target) * sol.step_bps));
    }
    case "offer":
    case "pattern": {
      // per round the right choice; the share of right rounds counts
      const want = (solution as { choices: number[] }).choices;
      if (!Array.isArray(ans.choices)) return 0;
      const got = ans.choices as unknown[];
      const hits = want.filter((w, i) => got[i] === w).length;
      return Math.trunc((hits * 10_000) / Math.max(want.length, 1));
    }
    case "shelf": {
      // givens unchanged; every filled gap without a twin in its row, column or box counts
      const sol = solution as { grid: number[]; blanks: number[] };
      if (!Array.isArray(ans.grid) || ans.grid.length !== 16) return 0;
      const g = ans.grid as unknown[];
      if (!g.every((v) => isInt(v) && v >= 0 && v <= 3)) return 0;
      const cells = g as number[];
      for (let i = 0; i < 16; i++) if (!sol.blanks.includes(i) && cells[i] !== sol.grid[i]) return 0;
      const clash = (i: number) => {
        const r = Math.floor(i / 4);
        const c = i % 4;
        for (let j = 0; j < 16; j++) {
          if (j === i || cells[j] !== cells[i]) continue;
          const rj = Math.floor(j / 4);
          const cj = j % 4;
          if (
            rj === r ||
            cj === c ||
            (Math.floor(rj / 2) === Math.floor(r / 2) && Math.floor(cj / 2) === Math.floor(c / 2))
          )
            return true;
        }
        return false;
      };
      const ok = sol.blanks.filter((i) => !clash(i)).length;
      return Math.trunc((ok * 10_000) / Math.max(sol.blanks.length, 1));
    }
  }
}
