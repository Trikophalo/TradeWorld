"use client";

import { create } from "zustand";

/*
 * Features the player has opened at least once (ADR-102), so "Heute dran" can point to what is new. Browser storage
 * only: a convenience, the game works the same without it.
 */
const KEY = "nexa-seen-features";

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

interface SeenState {
  ready: boolean;
  seen: string[];
  load: () => void;
  mark: (key: string) => void;
}

export const useSeenFeatures = create<SeenState>((set, get) => ({
  ready: false,
  seen: [],
  load: () => {
    if (!get().ready) set({ ready: true, seen: read() });
  },
  mark: (key) => {
    const seen = get().ready ? get().seen : read();
    if (seen.includes(key)) return;
    const next = [...seen, key];
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode: only for this session */
    }
    set({ ready: true, seen: next });
  },
}));
