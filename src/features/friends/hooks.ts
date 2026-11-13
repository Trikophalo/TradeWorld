"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { engine } from "@/features/game/store";
import type { FriendCode, Friends } from "@/features/game/types";

/** Friends (ADR-084). */
export const FRIENDS_KEY = ["friends"] as const;

export function useFriends() {
  return useQuery({ queryKey: FRIENDS_KEY, queryFn: () => engine.friends(), refetchInterval: 60_000 });
}

/** Writes a fresh list from a mutation straight into the cache. */
export function useSetFriends() {
  const client = useQueryClient();
  return (friends: Friends) => client.setQueryData(FRIENDS_KEY, friends);
}

/** Friend code (ADR-111). */
export const FRIEND_CODE_KEY = ["friend-code"] as const;

export function useFriendCode() {
  return useQuery({ queryKey: FRIEND_CODE_KEY, queryFn: () => engine.friendCode(), refetchInterval: 120_000 });
}

export function useSetFriendCode() {
  const client = useQueryClient();
  return (code: FriendCode) => client.setQueryData(FRIEND_CODE_KEY, code);
}

export type FriendStatus = "self" | "friends" | "incoming" | "outgoing" | "none";

export function friendStatus(friends: Friends | undefined, nickname: string, me: string): FriendStatus {
  const same = (a: string) => a.toLowerCase() === nickname.toLowerCase();
  if (same(me)) return "self";
  if (!friends) return "none";
  if (friends.friends.some((f) => same(f.nickname))) return "friends";
  if (friends.incoming.some((f) => same(f.nickname))) return "incoming";
  if (friends.outgoing.some((f) => same(f.nickname))) return "outgoing";
  return "none";
}
