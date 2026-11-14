"use client";

import { create } from "zustand";

/*
 * The newest patch note the player has seen (ADR-137). Browser storage only: it drives the blue dot on the button and
 * nothing else, so a private window simply shows the dot again.
 */
const KEY = "nexa-patch-notes-seen";

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

interface PatchNotesSeenState {
  /** False until `load` ran after hydration; the dot stays hidden until then. */
  ready: boolean;
  seenId: string | null;
  load: () => void;
  markSeen: (id: string) => void;
}

export const usePatchNotesSeen = create<PatchNotesSeenState>((set, get) => ({
  ready: false,
  seenId: null,
  load: () => {
    if (!get().ready) set({ ready: true, seenId: read() });
  },
  markSeen: (id) => {
    try {
      window.localStorage.setItem(KEY, id);
    } catch {
      /* private mode: only for this session */
    }
    set({ ready: true, seenId: id });
  },
}));
