"use client";

import { useClock } from "@/lib/use-now";
import { useGame } from "./store";

/** Smaller differences are network delay and snapshot age, not a wrong clock. */
const MIN_SKEW_MS = 60_000;

/** A device clock that is off by more than a minute, measured against the server time of the market snapshot. */
export function clockSkew(skewMs: number): number {
  return Math.abs(skewMs) >= MIN_SKEW_MS ? skewMs : 0;
}

/**
 * How far this device's clock is ahead of the server (ms, 0 when it is about right). Timers that end at a server
 * time add it to their target, so a wrong device clock neither hides a running cooldown nor ends it early.
 */
export function useClockSkew(): number {
  return useGame((state) => clockSkew(state.clockSkewMs));
}

/** The server's "now" (epoch ms, once per second); null until the client clock is available. */
export function useServerClock(): number | null {
  const now = useClock();
  const skew = useClockSkew();
  return now === null ? null : now - skew;
}
