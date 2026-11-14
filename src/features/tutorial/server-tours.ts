"use client";

import { engine } from "@/features/game/store";
import { useTutorial } from "./store";

/*
 * Finn's seen tours on the server. The browser's list alone was lost in private windows and on new devices, so every
 * tour started again. Loading fetches the server's list; every tour seen from then on is sent along (fire and forget:
 * if it fails, the browser still remembers it).
 */
const known = new Set<string>();
let watching = false;

function send(tours: readonly string[]) {
  for (const key of tours) {
    if (known.has(key)) continue;
    known.add(key);
    engine.markTourSeen(crypto.randomUUID(), key).catch(() => known.delete(key));
  }
}

/** Reads the server's tours and from then on reports newly seen ones. Returns [] when the server is unreachable. */
export async function syncSeenTours(): Promise<string[]> {
  let server: string[] = [];
  try {
    server = await engine.seenTours();
  } catch {
    // Offline or an older database: the browser's list still works.
  }
  known.clear();
  for (const key of server) known.add(key);
  if (!watching) {
    watching = true;
    useTutorial.subscribe((state, prev) => {
      if (state.status === "loading" || state.seenTours === prev.seenTours) return;
      send(state.seenTours);
    });
  }
  // Tours this browser saw before the server remembered them are sent once the store has loaded (by the subscription).
  return server;
}
