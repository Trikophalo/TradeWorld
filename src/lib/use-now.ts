"use client";

import { useSyncExternalStore } from "react";

/*
 * Clock access for components. Both hooks return null on the server and
 * during hydration, so server and client markup are identical; the real
 * value arrives in the first client render after that.
 */

let mountTime: number | null = null;
const subscribeNever = () => () => {};

/** A fixed "now" (epoch ms), captured once per page load. For anchoring demo data. */
export function useMountTime(): number | null {
  return useSyncExternalStore(
    subscribeNever,
    () => (mountTime ??= Date.now()),
    () => null,
  );
}

let current = 0;
let timer: number | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === undefined) {
    timer = window.setInterval(() => {
      current = Date.now();
      for (const notify of listeners) notify();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Epoch ms, updated once per second. All subscribers share one timer. */
export function useClock(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => (current ||= Date.now()),
    () => null,
  );
}
