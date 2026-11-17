"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  player: (nickname: string | null, limit: number | null) => ["nexamon", "player", nickname ?? "", limit] as const,
  bonuses: ["nexamon", "bonuses"] as const,
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

/**
 * What a player collected, for their profile (null = the own collection). `limit` asks for the most valuable
 * cards only; the numbers always cover everything.
 */
export function usePlayerNexamon(nickname: string | null, limit: number | null = null, enabled = true) {
  return useQuery({
    queryKey: NEXAMON_KEYS.player(nickname, limit),
    queryFn: () => engine.playerNexamon(nickname, limit),
    enabled,
    staleTime: REFRESH_MS,
  });
}

/** The own card bonuses, their totals against the caps and the collections (ADR-171). */
export function useNexamonBonuses(enabled = true) {
  return useQuery({
    queryKey: NEXAMON_KEYS.bonuses,
    queryFn: () => engine.nexamonBonuses(),
    enabled,
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

// ------------------------------------------------------------------------------------- remembered filters

const FILTERS_KEY = "nexa-nexamon-filters";

/**
 * Picks the remembered values that are still allowed: anything unknown (an old version, a hand edit) falls back
 * to the default, field by field.
 */
export function restoreFilters<T extends { [K in keyof T]: string }>(
  raw: unknown,
  defaults: T,
  allowed: { readonly [K in keyof T]: readonly string[] },
): T {
  const result = { ...defaults };
  if (raw === null || typeof raw !== "object") return result;
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value = (raw as Record<string, unknown>)[key as string];
    if (typeof value === "string" && allowed[key].includes(value)) result[key] = value as T[keyof T];
  }
  return result;
}

/**
 * Filters of a Nexamon page that this browser remembers (binder, market, the last tab). Read after hydration
 * (the server and the first render see the defaults); a blocked storage only means nothing is remembered.
 */
export function useRememberedFilters<T extends { [K in keyof T]: string }>(
  name: string,
  defaults: T,
  allowed: { readonly [K in keyof T]: readonly string[] },
): [T, (patch: Partial<T>) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => readStorage(FILTERS_KEY),
    () => null,
  );
  // defaults and allowed are module constants at every call site
  const value = useMemo(() => {
    let all: unknown = null;
    try {
      all = raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      all = null;
    }
    const mine = all && typeof all === "object" ? (all as Record<string, unknown>)[name] : null;
    return restoreFilters(mine, defaults, allowed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, name]);
  const set = useCallback(
    (patch: Partial<T>) => {
      let all: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(readStorage(FILTERS_KEY) ?? "{}");
        if (parsed && typeof parsed === "object") all = parsed as Record<string, unknown>;
      } catch {
        all = {};
      }
      writeStorage(FILTERS_KEY, JSON.stringify({ ...all, [name]: { ...value, ...patch } }));
    },
    [name, value],
  );
  return [value, set];
}
