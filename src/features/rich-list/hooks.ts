"use client";

import { useQuery } from "@tanstack/react-query";
import { engine } from "@/features/game/store";
import type { SectorKey } from "@/components/pixel/art";
import type { RichListScope } from "@/features/game/types";

const REFRESH_MS = 15_000;

export function useRichList(scope: RichListScope, limit = 100) {
  return useQuery({
    queryKey: ["rich-list", scope, limit],
    queryFn: () => engine.richList(scope, limit, 0),
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
  });
}

export function useRichNews(limit = 12) {
  return useQuery({
    queryKey: ["rich-news", limit],
    queryFn: () => engine.richNews(limit),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useCompanyRanking(scope: RichListScope, limit = 100, sector: SectorKey | null = null) {
  return useQuery({
    queryKey: ["company-ranking", scope, limit, sector],
    queryFn: () => engine.companyRanking(scope, limit, sector),
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
  });
}

/** The own net worth in parts (ADR-203): exactly the number the rich list counts. */
export function useMyNetWorth() {
  return useQuery({
    queryKey: ["my-net-worth"],
    queryFn: () => engine.myNetWorth(),
    refetchInterval: 30_000,
    staleTime: REFRESH_MS,
  });
}
