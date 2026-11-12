"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { engine, useGame } from "@/features/game/store";

export const PROPERTY_KEYS = {
  all: ["property"] as const,
  of: (nickname: string | null) => ["property", nickname ?? "me"] as const,
};

export function useProperty(nickname: string | null) {
  return useQuery({ queryKey: PROPERTY_KEYS.of(nickname), queryFn: () => engine.property(nickname) });
}

export function usePropertyRefresh() {
  const client = useQueryClient();
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: PROPERTY_KEYS.all }),
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
