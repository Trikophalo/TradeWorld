/**
 * Perfect answers for the task games of ADR-173, for tests (brute force; the games are tiny).
 */
import { tourLength } from "./company-tasks.ts";

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
