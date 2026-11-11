"use client";

import { useEffect } from "react";
import { useTutorial } from "./store";

/**
 * Starts Finn's short tour the first time a player sees a new area (ADR-068).
 * Waits for the first-session tutorial and any running tour; each tour runs once.
 */
export function useVisitTour(key: string, ready = true) {
  const status = useTutorial((state) => state.status);
  const busy = useTutorial((state) => state.tour !== null);
  const seen = useTutorial((state) => state.seenTours.includes(key));
  useEffect(() => {
    if (!ready || status !== "done" || busy || seen) return;
    const timer = window.setTimeout(() => useTutorial.getState().startTour(key), 600);
    return () => window.clearTimeout(timer);
  }, [key, ready, status, busy, seen]);
}
