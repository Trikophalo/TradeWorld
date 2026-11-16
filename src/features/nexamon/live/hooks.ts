"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { BALANCE } from "@/config/balance";
import type { NexamonLiveReport } from "@/features/game/pack-battle-types";
import { engine } from "@/features/game/store";
import { useSettings } from "@/stores/settings";

/*
 * Pack Battles and live openings on the client (ADR-172): the lobby is asked every presence.pingSeconds (that is
 * also the heartbeat), a running battle or a watched opening every second. The shared clock is the server's: every
 * answer carries server_time, the offset to the own clock is kept per answer.
 */
const cfg = BALANCE.nexamon;

export const LIVE_KEYS = {
  lobby: ["nexamon", "lobby"] as const,
  battle: (id: string) => ["nexamon", "battle", id] as const,
  live: (id: string) => ["nexamon", "live", id] as const,
};

export function useAllowWatch(): boolean {
  return useSettings((s) => s.watchable);
}

export function useNexamonLobby(enabled = true) {
  const allowWatch = useAllowWatch();
  return useQuery({
    queryKey: [...LIVE_KEYS.lobby, allowWatch],
    queryFn: () => engine.nexamonLobby(allowWatch),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.battles.some((b) => b.status === "pending" || b.status === "running")
        ? 2_000
        : cfg.presence.pingSeconds * 1000,
    refetchIntervalInBackground: false,
  });
}

export function useNexamonBattle(battleId: string | null) {
  return useQuery({
    queryKey: LIVE_KEYS.battle(battleId ?? ""),
    queryFn: () => engine.nexamonBattle(battleId!),
    enabled: Boolean(battleId),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "done" || s === "declined" || s === "expired" || s === "cancelled" || s === "aborted" ? false : 700;
    },
  });
}

export function useNexamonLive(liveId: string | null) {
  return useQuery({
    queryKey: LIVE_KEYS.live(liveId ?? ""),
    queryFn: () => engine.nexamonLive(liveId!),
    enabled: Boolean(liveId),
    refetchInterval: (query) => (query.state.data?.done ? false : 1_000),
  });
}

/** Refresh the lobby after an own action. */
export function useLobbyRefresh() {
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries({ queryKey: LIVE_KEYS.lobby }), [client]);
}

/**
 * The shared clock: `serverTime` minus the own clock at the moment the answer arrived, then the own clock ticks on
 * (every `stepMs`). Null before the first answer.
 */
export function useServerClock(serverTime: string | undefined, stepMs = 100): number | null {
  const offset = useRef<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!serverTime) return;
    const next = Date.parse(serverTime) - Date.now();
    // keep the smallest drift: a slow answer makes the server look behind
    offset.current = offset.current === null ? next : Math.max(offset.current, next);
  }, [serverTime]);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (offset.current !== null) setNow(Date.now() + offset.current);
    }, stepMs);
    return () => window.clearInterval(id);
  }, [stepMs]);
  return now;
}

/**
 * The opener's page: reports how many cards of the bought pack show, and every few seconds while the pack is open,
 * so spectators follow the real pace; returns how many watch.
 */
export function useLiveOpenerReport(packId: string | null, revealed: number): NexamonLiveReport | null {
  const [report, setReport] = useState<NexamonLiveReport | null>(null);
  const latest = useRef(revealed);
  useEffect(() => {
    latest.current = revealed;
  }, [revealed]);
  useEffect(() => {
    if (!packId) return;
    let alive = true;
    const send = () =>
      engine
        .reportNexamonLive(packId, latest.current)
        .then((r) => alive && setReport(r))
        .catch(() => undefined);
    void send();
    const id = window.setInterval(send, 3_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [packId]);
  useEffect(() => {
    if (!packId || revealed === 0) return;
    let alive = true;
    engine
      .reportNexamonLive(packId, revealed)
      .then((r) => alive && setReport(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [packId, revealed]);
  return packId ? report : null;
}
