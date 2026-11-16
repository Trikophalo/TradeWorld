"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ButtonState } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import type { NexamonMarketQuery, NexamonPackResult } from "@/features/game/nexamon-types";
import { engine, useGame } from "@/features/game/store";
import { haptic } from "@/lib/haptics";

/*
 * Nexamon cards (ADR-165) on the client: queries against the engine and the one way every action runs
 * (request id, button state, error text, refresh of everything that shows cards or cash).
 */
const REFRESH_MS = 20_000;

export const NEXAMON_KEYS = {
  all: ["nexamon"] as const,
  overview: ["nexamon", "overview"] as const,
  collection: ["nexamon", "collection"] as const,
  card: (key: string) => ["nexamon", "card", key] as const,
  market: (query: NexamonMarketQuery) => ["nexamon", "market", query] as const,
};

/** Sets, pack prices and the own collection in numbers. Works while the area is still locked. */
export function useNexamonOverview() {
  return useQuery({ queryKey: NEXAMON_KEYS.overview, queryFn: () => engine.nexamon(), refetchInterval: REFRESH_MS });
}

/** Every card with its value and the own copies. Only asked once the area is unlocked. */
export function useNexamonCollection(enabled = true) {
  return useQuery({
    queryKey: NEXAMON_KEYS.collection,
    queryFn: () => engine.nexamonCollection(null),
    enabled,
    refetchInterval: REFRESH_MS,
  });
}

export function useNexamonCard(cardKey: string | null, enabled = true) {
  return useQuery({
    queryKey: NEXAMON_KEYS.card(cardKey ?? ""),
    queryFn: () => engine.nexamonCard(cardKey!),
    enabled: enabled && Boolean(cardKey),
    refetchInterval: REFRESH_MS,
  });
}

export function useNexamonMarket(query: NexamonMarketQuery, enabled = true) {
  return useQuery({
    queryKey: NEXAMON_KEYS.market(query),
    queryFn: () => engine.nexamonMarket(query),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
}

/** After any card action: everything about cards, the cash and the missions. */
export function useNexamonRefresh() {
  const client = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: NEXAMON_KEYS.all }),
      useGame.getState().refreshPortfolio(),
      useGame.getState().refreshMissions(),
    ]);
  }, [client]);
}

export interface ActionOptions<T> {
  /** Title of the error toast. */
  errorTitle: string;
  onDone?: (result: T) => void;
  /** Called with the error key instead of the toast when it returns true (e.g. a changed price). */
  onError?: (error: unknown) => boolean;
}

/**
 * Runs one writing action: the button shows loading and success, errors become a toast in plain words, and
 * afterwards everything is read again (also after an error: the server's state is the truth).
 */
export function useNexamonAction() {
  const errorText = useGameErrorText();
  const refresh = useNexamonRefresh();
  const [state, setState] = useState<ButtonState>("idle");
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const run = useCallback(
    async <T>(action: (requestId: string) => Promise<T>, options: ActionOptions<T>): Promise<T | null> => {
      setState("loading");
      try {
        const result = await action(crypto.randomUUID());
        setState("success");
        haptic("success");
        timer.current = window.setTimeout(() => setState("idle"), 900);
        options.onDone?.(result);
        void refresh();
        return result;
      } catch (error) {
        setState("idle");
        if (!options.onError?.(error)) toast.error(options.errorTitle, errorText(error));
        void refresh();
        return null;
      }
    },
    [errorText, refresh],
  );
  return { state, busy: state === "loading", run };
}

// ---------------------------------------------------------------------------------- browser-side memory

const PENDING_PACK_KEY = "nexa-nexamon-pending-pack";
const REVEALED_KEY = "nexa-nexamon-revealed";
const listeners = new Set<() => void>();
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
};
const changed = () => listeners.forEach((listener) => listener());

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode: the memory lasts for this page only.
  }
  changed();
}

function parsePack(raw: string | null): NexamonPackResult | null {
  if (!raw) return null;
  try {
    const pack = JSON.parse(raw) as NexamonPackResult;
    return Array.isArray(pack.cards) && typeof pack.set === "string" ? pack : null;
  } catch {
    return null;
  }
}

let packCache: { raw: string | null; pack: NexamonPackResult | null } = { raw: null, pack: null };

/**
 * A bought pack that was not opened to the end (window closed, page reloaded). The cards are in the collection
 * either way; this only keeps the fun of opening it. Read after hydration, like every localStorage value.
 */
export function usePendingPack() {
  const pack = useSyncExternalStore(
    subscribe,
    () => {
      const raw = readStorage(PENDING_PACK_KEY);
      if (raw !== packCache.raw) packCache = { raw, pack: parsePack(raw) };
      return packCache.pack;
    },
    () => null,
  );
  const set = useCallback((next: NexamonPackResult | null) => {
    writeStorage(PENDING_PACK_KEY, next ? JSON.stringify(next) : null);
  }, []);
  return [pack, set] as const;
}

let revealedCache: { raw: string | null; list: readonly string[] } = { raw: null, list: [] };
const NO_REVEALS: readonly string[] = [];

/** Slabs the player has already looked at on this device (the grade reveal plays once per slab). */
export function useRevealedSlabs() {
  const revealed = useSyncExternalStore(
    subscribe,
    () => {
      const raw = readStorage(REVEALED_KEY);
      if (raw !== revealedCache.raw) {
        let list: string[] = [];
        try {
          const parsed: unknown = JSON.parse(raw ?? "[]");
          if (Array.isArray(parsed)) list = parsed.filter((x): x is string => typeof x === "string");
        } catch {
          list = [];
        }
        revealedCache = { raw, list };
      }
      return revealedCache.list;
    },
    () => NO_REVEALS,
  );
  const mark = useCallback((keys: readonly string[]) => {
    const next = [...new Set([...revealedCache.list, ...keys])].slice(-500);
    writeStorage(REVEALED_KEY, JSON.stringify(next));
  }, []);
  return [revealed, mark] as const;
}
