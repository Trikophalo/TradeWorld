/**
 * Candle aggregation from ticks (spec 4). Clock-aligned intervals (1 min, 5 min,
 * 1 h) use `bucketStartMs`. Quarter and game-year candles follow the rows of
 * `game_quarters` (ADR-006) and are built with `mergeCandles()`.
 */
import type { Candle, PriceTick } from "./types.ts";

/** Start of the interval bucket that contains `timeMs`. */
export function bucketStartMs(timeMs: number, intervalMs: number, originMs = 0): number {
  if (!(intervalMs > 0)) throw new RangeError("intervalMs must be > 0");
  return originMs + Math.floor((timeMs - originMs) / intervalMs) * intervalMs;
}

/**
 * Incremental update, the operation the tick runner performs: returns the
 * updated current candle, or a new candle if the tick opens the next bucket.
 * A new candle opens at the tick price (not at the previous close).
 */
export function applyTickToCandle(current: Candle | null, tick: PriceTick, intervalMs: number, originMs = 0): Candle {
  const startMs = bucketStartMs(tick.timeMs, intervalMs, originMs);
  if (current === null || current.startMs !== startMs) {
    return {
      startMs,
      openE4: tick.priceE4,
      highE4: tick.priceE4,
      lowE4: tick.priceE4,
      closeE4: tick.priceE4,
      volumeShares: tick.volumeShares,
    };
  }
  return {
    startMs,
    openE4: current.openE4,
    highE4: tick.priceE4 > current.highE4 ? tick.priceE4 : current.highE4,
    lowE4: tick.priceE4 < current.lowE4 ? tick.priceE4 : current.lowE4,
    closeE4: tick.priceE4,
    volumeShares: current.volumeShares + tick.volumeShares,
  };
}

/** Aggregates ticks (any order) into candles sorted by time. Empty buckets produce no candle. */
export function aggregateCandles(ticks: readonly PriceTick[], intervalMs: number, originMs = 0): Candle[] {
  const sorted = [...ticks].sort((a, b) => a.timeMs - b.timeMs);
  const candles: Candle[] = [];
  let current: Candle | null = null;
  for (const tick of sorted) {
    const next = applyTickToCandle(current, tick, intervalMs, originMs);
    if (current !== null && next.startMs !== current.startMs) candles.push(current);
    current = next;
  }
  if (current !== null) candles.push(current);
  return candles;
}

/**
 * Merges candles of a finer interval into one candle starting at `startMs`
 * (5 min from 1 min, quarter from 1 h, game year from quarters). Returns `null`
 * for an empty input.
 */
export function mergeCandles(candles: readonly Candle[], startMs?: number): Candle | null {
  const sorted = [...candles].sort((a, b) => a.startMs - b.startMs);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return null;
  let highE4 = first.highE4;
  let lowE4 = first.lowE4;
  let volumeShares = BigInt(0);
  for (const c of sorted) {
    if (c.highE4 > highE4) highE4 = c.highE4;
    if (c.lowE4 < lowE4) lowE4 = c.lowE4;
    volumeShares += c.volumeShares;
  }
  return {
    startMs: startMs ?? first.startMs,
    openE4: first.openE4,
    highE4,
    lowE4,
    closeE4: last.closeE4,
    volumeShares,
  };
}
