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
}

interface TutorialState {
  status: TutorialStatus;
  step: number;
  accountId: string;
  load: (accountId: string) => void;
  setStep: (step: number) => void;
  finish: () => void;
  /** Development helper, used by the showcase page. */
  restart: () => void;
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

  load: (accountId) => {
    const saved = readAll()[accountId];
    set({ accountId, status: saved?.status ?? "active", step: saved?.step ?? 0 });
  },
  setStep: (step) => {
    save(get().accountId, { status: "active", step });
    set({ step });
  },
  finish: () => {
    save(get().accountId, { status: "done", step: 0 });
    set({ status: "done", step: 0 });
  },
  restart: () => {
    save(get().accountId, { status: "active", step: 0 });
    set({ status: "active", step: 0 });
  },
}));

/** True while the tutorial is running. Shortcuts and the search stay off meanwhile. */
export function isTutorialActive(): boolean {
  return useTutorial.getState().status === "active";
}

// ---- Events: game components report what the player did.

export type TutorialEvent = "vault-claimed" | "order-sheet-opened" | "order-sheet-closed" | "order-confirmed";

const listeners = new Set<(event: TutorialEvent) => void>();

export function emitTutorial(event: TutorialEvent): void {
  for (const listener of listeners) listener(event);
}

export function onTutorialEvent(listener: (event: TutorialEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
