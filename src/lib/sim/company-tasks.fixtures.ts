/**
 * Perfect answers for the task games of ADR-173 and ADR-186, for tests (brute force; the games are tiny).
 */
import { tourLength } from "./company-tasks.ts";
import { PIPE_BASE, slideTiles, turnMask } from "./company-tasks-visual.ts";

/** tiles: the fewest slides that solve a sliding puzzle (breadth-first; 3 x 3 has at most 9!/2 boards). */
export function tileMoves(size: number, board: readonly number[]): number[] {
  const key = (b: readonly number[]) => b.join(",");
  const goal = key(Array.from({ length: size * size }, (_, i) => (i < size * size - 1 ? i : -1)));
  const prev = new Map<string, [string, number] | null>([[key(board), null]]);
  const queue: number[][] = [[...board]];
  for (let head = 0; head < queue.length; head++) {
    const b = queue[head]!;
    const k = key(b);
    if (k === goal) {
      const moves: number[] = [];
      for (let at = prev.get(k); at; at = prev.get(at[0])) moves.unshift(at[1]);
      return moves;
    }
    const gap = b.indexOf(-1);
    const next = [gap - size, gap + size, gap % size > 0 ? gap - 1 : -1, gap % size < size - 1 ? gap + 1 : -1];
    for (const m of next) {
      if (m < 0 || m >= b.length) continue;
      const after = slideTiles(size, b, [m])!;
      if (!prev.has(key(after))) {
        prev.set(key(after), [k, m]);
        queue.push(after);
      }
    }
  }
  throw new Error("unsolvable sliding puzzle");
}

/** pipes: turns that make every pipe of the route fit (the rest stays at 0). */
export function pipeTurns(sol: {
  tiles: readonly number[];
  path: readonly number[];
  need: readonly number[];
}): number[] {
  const turns = sol.tiles.map(() => 0);
  sol.path.forEach((cell, k) => {
    while (turnMask(PIPE_BASE[sol.tiles[cell] === 1 ? 1 : 0], turns[cell]!) !== sol.need[k])
      turns[cell] = turns[cell]! + 1;
  });
  return turns;
}

/** memory: every pair of equal cards. */
export function memoryPairs(cards: readonly number[]): [number, number][] {
  const pairs: [number, number][] = [];
  const seen = new Map<number, number>();
  cards.forEach((label, i) => {
    const j = seen.get(label);
    if (j === undefined) seen.set(label, i);
    else pairs.push([j, i]);
  });
  return pairs;
}

/** route: an order of the stops with the shortest round trip. */
export function bestOrder(points: readonly (readonly [number, number])[]): number[] {
  let best: number[] = [];
  let bestLen = Number.POSITIVE_INFINITY;
  const walk = (rest: number[], done: number[]) => {
    if (rest.length === 0) {
      const len = tourLength(points, done);
      if (len < bestLen) {
        bestLen = len;
        best = done;
      }
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

/** pack: the items of the most valuable load within the capacity. */
export function bestLoad(weights: readonly number[], values: readonly number[], cap: number): number[] {
  let best: number[] = [];
  let bestValue = -1;
  for (let mask = 0; mask < 1 << weights.length; mask++) {
    const idx = weights.flatMap((_, i) => (mask & (1 << i) ? [i] : []));
    const w = idx.reduce((s, i) => s + weights[i]!, 0);
    const v = idx.reduce((s, i) => s + values[i]!, 0);
    if (w <= cap && v > bestValue) {
      bestValue = v;
      best = idx;
    }
  }
  return best;
}
