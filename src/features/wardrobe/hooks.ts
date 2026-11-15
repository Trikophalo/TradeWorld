"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CAREER_KEYS } from "@/features/career/hooks";
import { engine, useGame } from "@/features/game/store";
import type { Wardrobe } from "@/features/game/types";

/** The own wardrobe (ADR-154). */
export const WARDROBE_KEY = ["wardrobe"] as const;

export function useWardrobe() {
  return useQuery({ queryKey: WARDROBE_KEY, queryFn: () => engine.accessories(), staleTime: 30_000 });
}

/** Writes a fresh wardrobe into the cache and lets the own card (figure on the profile) reload. */
export function useSetWardrobe() {
  const client = useQueryClient();
  const nickname = useGame((state) => state.portfolio?.nickname ?? "");
  return (wardrobe: Wardrobe) => {
    client.setQueryData(WARDROBE_KEY, wardrobe);
    if (nickname) void client.invalidateQueries({ queryKey: CAREER_KEYS.card(nickname) });
  };
}

/** What the figure shows: the worn accessories, with the one being tried on in its slot. */
export function previewWorn(
  worn: readonly string[],
  preview: string | null,
  slotOf: (key: string) => string | undefined,
) {
  if (!preview) return [...worn];
  const slot = slotOf(preview);
  return [...worn.filter((key) => slotOf(key) !== slot), preview];
}
