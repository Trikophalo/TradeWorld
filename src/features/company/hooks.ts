"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { engine, useGame } from "@/features/game/store";

/** Player company data (ADR-057). Mutations invalidate everything under ["company"] and ["career"]. */
export function useMyCompany() {
  return useQuery({
    queryKey: ["company", "mine"],
    queryFn: () => engine.myCompany(),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useCompanyPostings(enabled: boolean) {
  return useQuery({ queryKey: ["company", "postings"], queryFn: () => engine.companyPostings(), enabled });
}

export function useCompanyApplications(companyId: string | undefined) {
  return useQuery({
    queryKey: ["company", "applications", companyId],
    queryFn: () => engine.companyApplications(companyId!),
    enabled: Boolean(companyId),
    refetchInterval: 30_000,
  });
}

export function useCompanyTeam(companyId: string | undefined) {
  return useQuery({
    queryKey: ["company", "team", companyId],
    queryFn: () => engine.companyTeam(companyId!),
    enabled: Boolean(companyId),
    refetchInterval: 60_000,
  });
}

export function useCompanyRefresh() {
  const client = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["company"] }),
      client.invalidateQueries({ queryKey: ["career"] }),
      client.invalidateQueries({ queryKey: ["rich-list"] }),
      useGame.getState().refreshPortfolio(),
    ]);
  }, [client]);
}

/** Company colours to choose from (data, like the AI companies' brand colours). */
export const COMPANY_COLORS = [
  "#6a54f0",
  "#1f8fff",
  "#0f9e8a",
  "#2fb45a",
  "#e0a100",
  "#ef6c1a",
  "#e0384f",
  "#c03fb8",
] as const;

/** Company crisis or chance (ADR-091): own company (no id) or the employer's (id). */
export function useCompanyEvent(companyId?: string | null) {
  return useQuery({
    queryKey: ["company", "event", companyId ?? "mine"],
    queryFn: () => engine.companyEvent(companyId ?? null),
    refetchInterval: 30_000,
  });
}

/** Company news for the founder and the staff (ADR-091). */
export function useCompanyNews(companyId?: string | null) {
  return useQuery({
    queryKey: ["company", "news", companyId ?? "mine"],
    queryFn: () => engine.companyNews(companyId ?? null),
    refetchInterval: 60_000,
  });
}
