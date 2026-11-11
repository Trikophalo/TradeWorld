"use client";

import { useQuery } from "@tanstack/react-query";
import { engine } from "@/features/game/store";
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

export function useCompanyRanking(scope: RichListScope, limit = 100) {
  return useQuery({
    queryKey: ["company-ranking", scope, limit],
    queryFn: () => engine.companyRanking(scope, limit),
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
  });
}
