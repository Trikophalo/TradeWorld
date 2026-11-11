"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { engine, useGame } from "@/features/game/store";

/** Query keys of the career part; mutations invalidate them all at once. */
export const CAREER_KEYS = {
  skills: ["career", "skills"],
  board: ["career", "board"],
  applications: ["career", "applications"],
  job: ["career", "job"],
  daily: ["career", "daily"],
  card: (nickname: string) => ["career", "card", nickname.toLowerCase()],
} as const;

export function useSkills() {
  return useQuery({ queryKey: CAREER_KEYS.skills, queryFn: () => engine.skills(), staleTime: 15_000 });
}

export function useJobBoard() {
  return useQuery({ queryKey: CAREER_KEYS.board, queryFn: () => engine.jobBoard(), staleTime: 30_000 });
}

export function useApplications() {
  return useQuery({
    queryKey: CAREER_KEYS.applications,
    queryFn: () => engine.applications(),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useMyJob() {
  return useQuery({
    queryKey: CAREER_KEYS.job,
    queryFn: () => engine.myJob(),
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}

export function useDailyReward(enabled: boolean) {
  return useQuery({ queryKey: CAREER_KEYS.daily, queryFn: () => engine.dailyReward(), enabled, staleTime: 60_000 });
}

export function usePlayerCard(nickname: string) {
  return useQuery({
    queryKey: CAREER_KEYS.card(nickname),
    queryFn: () => engine.playerCard(nickname),
    enabled: nickname.length > 0,
    staleTime: 30_000,
    retry: false,
  });
}

/** After any career action: reload everything that may have changed, including cash and XP. */
export function useCareerRefresh() {
  const client = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["career"] }),
      useGame.getState().refreshPortfolio(),
      useGame.getState().refreshMissions(),
    ]);
  }, [client]);
}
