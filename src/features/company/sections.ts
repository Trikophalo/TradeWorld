"use client";

import { create } from "zustand";

/*
 * Which sections of the company page are open (ADR-138; Dashboard and Controlling since ADR-167). Remembered in this
 * browser; read after hydration. The till, the quarter and the strategy are open by default, the rest is folded.
 */
const STORAGE_KEY = "nexa-company-sections";
export const DEFAULT_OPEN: readonly string[] = ["money", "numbers", "profit"];

interface SectionsState {
  open: string[];
  loaded: boolean;
  load: () => void;
  toggle: (id: string, open: boolean) => void;
  /** Opens a section and scrolls to an element inside it (or to the section). */
  reveal: (id: string, target?: string) => void;
}

function save(open: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(open));
  } catch {
    // Private mode: the sections simply start folded again.
  }
}

export const useCompanySections = create<SectionsState>((set, get) => ({
  open: [...DEFAULT_OPEN],
  loaded: false,
  load: () => {
    if (get().loaded) return;
    try {
      const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
      if (Array.isArray(raw)) set({ open: raw.filter((x): x is string => typeof x === "string") });
    } catch {
      // Nothing saved.
    }
    set({ loaded: true });
  },
  toggle: (id, open) => {
    const next = open ? [...new Set([...get().open, id])] : get().open.filter((x) => x !== id);
    set({ open: next });
    save(next);
  },
  reveal: (id, target) => {
    if (!get().open.includes(id)) get().toggle(id, true);
    window.setTimeout(() => {
      const el = document.getElementById(target ?? `section-${id}`) ?? document.getElementById(`section-${id}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  },
}));
