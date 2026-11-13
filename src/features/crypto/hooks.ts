"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { BALANCE } from "@/config/balance";
import { engine, useGame } from "@/features/game/store";
import type { CandleInterval } from "@/features/game/types";

/** Crypto market, coins and the own coin (ADR-101). Prices move every few seconds, around the clock. */
export const CRYPTO_KEY = ["crypto"] as const;
const TICK_MS = BALANCE.crypto.tickSeconds * 1000;

export function useCryptoMarket(enabled = true) {
  return useQuery({
    queryKey: [...CRYPTO_KEY, "market"],
    queryFn: () => engine.cryptoMarket(),
    refetchInterval: TICK_MS,
    staleTime: TICK_MS,
    enabled,
  });
}

export function useCoin(ticker: string, enabled = true) {
  return useQuery({
    queryKey: [...CRYPTO_KEY, "coin", ticker],
    queryFn: () => engine.coin(ticker),
    refetchInterval: TICK_MS,
    staleTime: TICK_MS,
    enabled,
  });
}

export const COIN_RANGES = ["1T", "1W"] as const;
export type CoinRange = (typeof COIN_RANGES)[number];
const RANGE: Record<CoinRange, { interval: CandleInterval; limit: number }> = {
  "1T": { interval: "5m", limit: 288 },
  "1W": { interval: "1h", limit: 168 },
};

export function useCoinCandles(ticker: string, range: CoinRange) {
  const { interval, limit } = RANGE[range];
  return useQuery({
    queryKey: [...CRYPTO_KEY, "candles", ticker, interval],
    queryFn: () => engine.candles(ticker, interval, limit),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useMyCoin(enabled = true) {
  return useQuery({
    queryKey: [...CRYPTO_KEY, "mine"],
    queryFn: () => engine.myCoin(),
    refetchInterval: 15_000,
    staleTime: 5_000,
    enabled,
  });
}

/** After a trade or a coin action: crypto data and the portfolio (cash, positions). */
export function useCryptoRefresh() {
  const client = useQueryClient();
  return useCallback(async () => {
    await Promise.all([client.invalidateQueries({ queryKey: CRYPTO_KEY }), useGame.getState().refreshPortfolio()]);
  }, [client]);
}
