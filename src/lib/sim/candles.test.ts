import { describe, expect, it } from "vitest";
import { aggregateCandles, applyTickToCandle, bucketStartMs, mergeCandles } from "./candles.ts";
import type { PriceTick } from "./types.ts";

const b = (n: number) => BigInt(n);
const tick = (timeMs: number, price: number, volume = 1): PriceTick => ({
  timeMs,
  priceE4: b(price),
  volumeShares: b(volume),
});

describe("candles", () => {
  it("aligns buckets", () => {
    expect(bucketStartMs(61_000, 60_000)).toBe(60_000);
    expect(bucketStartMs(59_999, 60_000)).toBe(0);
    expect(bucketStartMs(-1, 60_000)).toBe(-60_000);
    expect(bucketStartMs(65_000, 60_000, 5_000)).toBe(65_000);
    expect(() => bucketStartMs(1, 0)).toThrow(RangeError);
  });

  it("aggregates open, high, low, close and volume", () => {
    const candles = aggregateCandles(
      [tick(0, 100, 5), tick(5_000, 120, 1), tick(10_000, 90, 2), tick(55_000, 110, 3), tick(60_000, 115, 7)],
      60_000,
    );
    expect(candles).toEqual([
      { startMs: 0, openE4: b(100), highE4: b(120), lowE4: b(90), closeE4: b(110), volumeShares: b(11) },
      { startMs: 60_000, openE4: b(115), highE4: b(115), lowE4: b(115), closeE4: b(115), volumeShares: b(7) },
    ]);
  });

  it("sorts unordered ticks and skips empty buckets", () => {
    const candles = aggregateCandles([tick(190_000, 3), tick(1_000, 1), tick(2_000, 2)], 60_000);
    expect(candles.map((c) => c.startMs)).toEqual([0, 180_000]);
    expect(candles[0]).toMatchObject({ openE4: b(1), closeE4: b(2) });
    expect(aggregateCandles([], 60_000)).toEqual([]);
  });

  it("incremental updates equal the batch aggregation", () => {
    const ticks = Array.from({ length: 200 }, (_, i) => tick(i * 5_000, 1000 + ((i * 37) % 91) - 45, i % 4));
    const batch = aggregateCandles(ticks, 60_000);
    const incremental: ReturnType<typeof aggregateCandles> = [];
    let current: ReturnType<typeof applyTickToCandle> | null = null;
    for (const t of ticks) {
      const next = applyTickToCandle(current, t, 60_000);
      if (current && next.startMs !== current.startMs) incremental.push(current);
      current = next;
    }
    if (current) incremental.push(current);
    expect(incremental).toEqual(batch);
  });

  it("merging 1 min candles gives the 5 min candle", () => {
    const ticks = Array.from({ length: 120 }, (_, i) => tick(i * 5_000, 500 + ((i * 53) % 71), 2));
    const oneMinute = aggregateCandles(ticks, 60_000);
    const fiveMinutes = aggregateCandles(ticks, 300_000);
    const merged = mergeCandles(oneMinute.filter((c) => c.startMs < 300_000));
    expect(merged).toEqual(fiveMinutes[0]);
    expect(mergeCandles([])).toBeNull();
    expect(mergeCandles(oneMinute, 42)?.startMs).toBe(42);
  });

  it("every candle satisfies low <= open, close <= high", () => {
    const ticks = Array.from({ length: 500 }, (_, i) => tick(i * 5_000, 1000 + ((i * 7919) % 211)));
    for (const c of aggregateCandles(ticks, 300_000)) {
      expect(c.lowE4 <= c.openE4 && c.openE4 <= c.highE4).toBe(true);
      expect(c.lowE4 <= c.closeE4 && c.closeE4 <= c.highE4).toBe(true);
    }
  });
});
