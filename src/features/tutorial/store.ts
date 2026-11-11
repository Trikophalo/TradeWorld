"use client";

import { create } from "zustand";

/*
 * Tutorial progress. Kept per account in localStorage so a reload resumes at
 * the same step. From M2 the "done" flag and the XP reward live on the server
 * (RPC `complete_tutorial`); this store then only mirrors it.
 */
const STORAGE_KEY = "nexa-tutorial";

export type TutorialStatus = "loading" | "active" | "done";

interface Saved {
  status: "active" | "done";
  step: number;
  /** Unlock tours already shown (ADR-046). */
  seenTours?: string[];
}

interface TutorialState {
  status: TutorialStatus;
  step: number;
  accountId: string;
  /** A running unlock tour, if any. */
  tour: { key: string; step: number } | null;
  seenTours: string[];
  startTour: (key: string) => void;
  setTourStep: (step: number) => void;
  endTour: () => void;
  load: (accountId: string) => void;
  setStep: (step: number) => void;
  finish: () => void;
  /** Development helper, used by the showcase page. */
  restart: () => void;
  /** Back to "loading" (sign-out, account switch): the next account loads its own progress. */
  reset: () => void;
  /** Account reset (ADR-070): forget this account's progress, so Finn starts from the beginning. */
  forget: () => void;
}

function readAll(): Record<string, Saved> {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, Saved>;
  } catch {
    return {};
  }
}

function save(accountId: string, value: Saved): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [accountId]: value }));
  } catch {
    // Private mode: the tutorial simply restarts on the next visit.
  }
}

export const useTutorial = create<TutorialState>((set, get) => ({
  status: "loading",
  step: 0,
  accountId: "demo",
  tour: null,
  seenTours: [],

  load: (accountId) => {
    const saved = readAll()[accountId];
    set({ accountId, status: saved?.status ?? "active", step: saved?.step ?? 0, seenTours: saved?.seenTours ?? [] });
  },
  setStep: (step) => {
    save(get().accountId, { status: "active", step, seenTours: get().seenTours });
    set({ step });
  },
  finish: () => {
    save(get().accountId, { status: "done", step: 0, seenTours: get().seenTours });
    set({ status: "done", step: 0 });
  },
  reset: () => set({ status: "loading", step: 0, accountId: "demo", tour: null, seenTours: [] }),
  forget: () => {
    try {
      const saved = readAll();
      delete saved[get().accountId];
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Nothing saved.
    }
    get().reset();
  },
  restart: () => {
    save(get().accountId, { status: "active", step: 0, seenTours: [] });
    set({ status: "active", step: 0, seenTours: [], tour: null });
  },
  startTour: (key) => {
    const { seenTours, status } = get();
    if (status !== "done" || seenTours.includes(key)) return;
    const next = [...seenTours, key];
    // Marked as seen right away: a tour is never forced twice, even after a reload.
    save(get().accountId, { status: "done", step: 0, seenTours: next });
    set({ tour: { key, step: 0 }, seenTours: next });
  },
  setTourStep: (step) => set((state) => (state.tour ? { tour: { ...state.tour, step } } : {})),
  endTour: () => set({ tour: null }),
}));

/** True while the tutorial is running. Shortcuts and the search stay off meanwhile. */
export function isTutorialActive(): boolean {
  const { status, tour } = useTutorial.getState();
  return status === "active" || tour !== null;
}

// ---- Events: game components report what the player did.

export type TutorialEvent =
  | "vault-claimed"
  | "order-sheet-opened"
  | "order-sheet-closed"
  | "order-confirmed"
  | "limit-selected"
  | "bonds-tab-opened";

const listeners = new Set<(event: TutorialEvent) => void>();

export function emitTutorial(event: TutorialEvent): void {
  for (const listener of listeners) listener(event);
}

export function onTutorialEvent(listener: (event: TutorialEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
