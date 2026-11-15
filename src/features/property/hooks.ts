"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { engine, useGame } from "@/features/game/store";

export const PROPERTY_KEYS = {
  all: ["property"] as const,
  of: (nickname: string | null) => ["property", nickname ?? "me"] as const,
};

export const RENTAL_KEYS = {
  all: ["rentals"] as const,
  mine: ["rentals", "mine"] as const,
  market: ["rentals", "market"] as const,
};

/** Tenants come and go on the server's clock (ADR-158), so the home is looked at again now and then. */
const REFRESH_MS = 30_000;

export function useProperty(nickname: string | null) {
  return useQuery({
    queryKey: PROPERTY_KEYS.of(nickname),
    queryFn: () => engine.property(nickname),
    refetchInterval: REFRESH_MS,
  });
}

export function useRentals() {
  return useQuery({ queryKey: RENTAL_KEYS.mine, queryFn: () => engine.rentals(), refetchInterval: REFRESH_MS });
}

export function useRentalMarket() {
  return useQuery({ queryKey: RENTAL_KEYS.market, queryFn: () => engine.rentalMarket(), refetchInterval: REFRESH_MS });
}

export function usePropertyRefresh() {
  const client = useQueryClient();
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: PROPERTY_KEYS.all }),
      client.invalidateQueries({ queryKey: RENTAL_KEYS.all }),
      useGame.getState().refreshPortfolio(),
      useGame.getState().refreshMissions(),
    ]);
  };
}

/** The largest whole pixel scale at which `artWidth` art pixels fit into the element (at least 1, at most `max`). */
export function useFitScale(artWidth: number, max = 4) {
  // A callback ref: the element may appear later (inside a modal that opens).
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? 0;
      setScale(Math.max(1, Math.min(max, Math.floor(w / Math.max(1, artWidth)))));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, artWidth, max]);
  return { ref: setElement, scale };
}
