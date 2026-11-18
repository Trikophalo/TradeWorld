"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { COUNTRIES, type CountryConfig } from "@/config/countries";
import { engine } from "@/features/game/store";
import type { WorldPlace, WorldState } from "@/features/game/world-types";

/** Under ["company"], so useCompanyRefresh reloads it with the company. */
export const WORLD_KEY = ["company", "world"] as const;

export function useWorld(enabled = true) {
  return useQuery({ queryKey: WORLD_KEY, queryFn: () => engine.world(), refetchInterval: 60_000, enabled });
}

/** Writes the answer of a world action into the cache. */
export function useSetWorld() {
  const client = useQueryClient();
  return useCallback((next: WorldState) => client.setQueryData(WORLD_KEY, next), [client]);
}

export const countryOf = (key: string | null | undefined): CountryConfig | undefined =>
  key ? COUNTRIES.find((c) => c.key === key) : undefined;

/** Places per country, headquarters first (own first, then by tier and value). */
export function placesByCountry(places: readonly WorldPlace[]): Map<string, WorldPlace[]> {
  const rank = (p: WorldPlace) => (p.kind === "hq" ? 0 : p.kind === "subsidiary" ? 1 : 2);
  const map = new Map<string, WorldPlace[]>();
  for (const p of places) map.set(p.country, [...(map.get(p.country) ?? []), p]);
  for (const list of map.values()) {
    list.sort(
      (a, b) =>
        Number(b.mine) - Number(a.mine) ||
        rank(a) - rank(b) ||
        b.hqTier - a.hqTier ||
        (b.worthCents ?? 0) - (a.worthCents ?? 0) ||
        a.name.localeCompare(b.name),
    );
  }
  return map;
}
