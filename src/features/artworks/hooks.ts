"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { engine, useGame } from "@/features/game/store";
import type { ArtOrigin, ArtSort } from "@/features/game/types";

const REFRESH_MS = 10_000;
export const ART_KEYS = {
  all: ["art"] as const,
  list: (sort: ArtSort, origin: ArtOrigin, onAuction: boolean) => ["art", "list", sort, origin, onAuction] as const,
  detail: (id: string) => ["art", "detail", id] as const,
  studio: ["art", "studio"] as const,
  rankings: ["art", "rankings"] as const,
  collection: (nickname: string) => ["art", "collection", nickname] as const,
};

export function useArtworks(sort: ArtSort, origin: ArtOrigin, onAuction: boolean) {
  return useQuery({
    queryKey: ART_KEYS.list(sort, origin, onAuction),
    queryFn: () => engine.artworks(sort, origin, onAuction, 60, 0),
    refetchInterval: REFRESH_MS,
  });
}

export function useArtwork(id: string | null) {
  return useQuery({
    queryKey: ART_KEYS.detail(id ?? ""),
    queryFn: () => engine.artwork(id!),
    enabled: Boolean(id),
    refetchInterval: 5_000,
  });
}

export function useArtStudio() {
  return useQuery({ queryKey: ART_KEYS.studio, queryFn: () => engine.artStudio() });
}

export function useArtRankings() {
  return useQuery({ queryKey: ART_KEYS.rankings, queryFn: () => engine.artRankings(50), refetchInterval: 30_000 });
}

export function useCollection(nickname: string | null) {
  return useQuery({
    queryKey: ART_KEYS.collection(nickname ?? ""),
    queryFn: () => engine.collection(nickname!),
    enabled: Boolean(nickname),
  });
}

/** After any art action: everything art-related and the cash. */
export function useArtRefresh() {
  const client = useQueryClient();
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ART_KEYS.all }),
      useGame.getState().refreshPortfolio(),
      useGame.getState().refreshMissions(),
    ]);
  };
}
