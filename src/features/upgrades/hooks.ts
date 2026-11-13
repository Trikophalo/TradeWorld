"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { engine } from "@/features/game/store";
import type { UpgradesState } from "@/features/game/types";

/** Bought upgrades (ADR-093). */
export const UPGRADES_KEY = ["upgrades"] as const;

export function useUpgrades() {
  return useQuery({ queryKey: UPGRADES_KEY, queryFn: () => engine.upgrades(), staleTime: 60_000 });
}

export function useSetUpgrades() {
  const client = useQueryClient();
  return (state: UpgradesState) => client.setQueryData(UPGRADES_KEY, state);
}
