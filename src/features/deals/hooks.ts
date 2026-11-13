"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { engine, useGame } from "@/features/game/store";

/** Deals between players and trust (ADR-098). */
export const DEALS_KEY = ["deals"] as const;
export const BOARD_KEY = ["deals", "board"] as const;

export function useDeals() {
  return useQuery({ queryKey: DEALS_KEY, queryFn: () => engine.deals(), refetchInterval: 30_000, staleTime: 10_000 });
}

export function useDealBoard() {
  return useQuery({
    queryKey: BOARD_KEY,
    queryFn: () => engine.dealBoard(),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

/** After a deal action: deals, board, cash and the company (fees, prepayments, stakes). */
export function useDealsRefresh() {
  const client = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: DEALS_KEY }),
      client.invalidateQueries({ queryKey: ["company"] }),
      useGame.getState().refreshPortfolio(),
    ]);
  }, [client]);
}
