"use client";

import { useQuery } from "@tanstack/react-query";
import { BALANCE } from "@/config/balance";
import { engine, useGame } from "./store";
import type { CandleInterval } from "./types";

export const CHART_RANGES = ["1T", "1W", "1M", "1J"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

/**
 * Candle size per visible range. A game year lasts one real day, so the
 * yearly view shows one candle per real day.
 */
export const RANGE_CANDLES: Record<ChartRange, { interval: CandleInterval; limit: number }> = {
  "1T": { interval: "5m", limit: 288 },
  "1W": { interval: "1h", limit: 168 },
  "1M": { interval: "1q", limit: 124 },
  "1J": { interval: "1y", limit: 365 },
};

const TICK_MS = BALANCE.time.tickSeconds * 1000;

export function useCandles(ticker: string, range: ChartRange) {
  const { interval, limit } = RANGE_CANDLES[range];
  return useQuery({
    queryKey: ["candles", ticker, interval, limit],
    queryFn: () => engine.candles(ticker, interval, limit),
    staleTime: interval === "5m" ? 60_000 : 5 * 60_000,
    refetchInterval: interval === "5m" ? 60_000 : false,
  });
}

export function useOrderBook(ticker: string, enabled = true) {
  return useQuery({
    queryKey: ["orderbook", ticker],
    queryFn: () => engine.orderBook(ticker, 6),
    enabled,
    refetchInterval: TICK_MS,
    staleTime: TICK_MS,
  });
}

export function useSecurityDetails(ticker: string) {
  return useQuery({
    queryKey: ["details", ticker],
    queryFn: () => engine.details(ticker),
    staleTime: 5 * 60_000,
  });
}

/** Securities of one kind in snapshot order. */
export function useSecurities(kind: "stock" | "bond") {
  const snapshot = useGame((state) => state.snapshot);
  return snapshot?.securities.filter((s) => s.kind === kind) ?? null;
}
