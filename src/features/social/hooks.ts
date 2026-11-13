"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { engine } from "@/features/game/store";
import type { FeedItem, FeedPage, LeagueScope } from "@/features/game/types";

/** Friends feed (ADR-088), notifications, weekly league (ADR-089) and announced events (ADR-090). */
export const SOCIAL_KEYS = {
  feed: ["social", "feed"] as const,
  notifications: ["social", "notifications"] as const,
  league: (scope: LeagueScope, week: "current" | "last") => ["social", "league", scope, week] as const,
  events: ["social", "events"] as const,
};

export function useFeed() {
  return useInfiniteQuery({
    queryKey: SOCIAL_KEYS.feed,
    queryFn: ({ pageParam }) => engine.feed(pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (last: FeedPage) => last.nextBefore,
    refetchInterval: 60_000,
  });
}

/** Writes a changed item (reaction) into every loaded feed page. */
export function useUpdateFeedItem() {
  const client = useQueryClient();
  return (item: FeedItem) =>
    client.setQueryData<{ pages: FeedPage[]; pageParams: unknown[] }>(SOCIAL_KEYS.feed, (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((p) => ({ ...p, items: p.items.map((i) => (i.id === item.id ? item : i)) })),
          }
        : data,
    );
}

export function useNotifications() {
  return useQuery({
    queryKey: SOCIAL_KEYS.notifications,
    queryFn: () => engine.notifications(),
    refetchInterval: 45_000,
  });
}

export function useLeague(scope: LeagueScope, week: "current" | "last" = "current") {
  return useQuery({
    queryKey: SOCIAL_KEYS.league(scope, week),
    queryFn: () => engine.league(scope, week),
    refetchInterval: 120_000,
  });
}

export function useGameEvents() {
  return useQuery({ queryKey: SOCIAL_KEYS.events, queryFn: () => engine.events(), refetchInterval: 60_000 });
}
