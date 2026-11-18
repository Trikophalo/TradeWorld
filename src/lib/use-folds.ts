"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/*
 * Open and closed sections remembered in this browser, per player (ADR-201): one localStorage entry per page and
 * player. Read only after the hydration (the server and the first client render see nothing stored), every write
 * tells the other users of the same entry.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith("nexa-folds:")) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parse(raw: string | null): Record<string, boolean> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === "boolean")) as Record<
      string,
      boolean
    >;
  } catch {
    return {};
  }
}

/** The storage entry of a page for a player; null while the player is not known yet. */
export function foldsKey(page: string, player: string | null | undefined): string | null {
  return player ? `nexa-folds:${page}:${player.toLowerCase()}` : null;
}

/**
 * Stored open states of a page (undefined before the hydration or without a player) and a setter that remembers a
 * choice. Without storage (private mode, blocked) the choice lives for this visit in the caller's state.
 */
export function useStoredFolds(
  key: string | null,
): [Record<string, boolean> | undefined, (id: string, open: boolean) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => (key ? (read(key) ?? "") : undefined),
    () => undefined,
  );
  const folds = useMemo(() => (raw === undefined ? undefined : parse(raw)), [raw]);
  const remember = useCallback(
    (id: string, open: boolean) => {
      if (!key) return;
      try {
        window.localStorage.setItem(key, JSON.stringify({ ...parse(read(key)), [id]: open }));
      } catch {
        // storage blocked: nothing to remember
      }
      for (const listener of listeners) listener();
    },
    [key],
  );
  return [folds, remember];
}
