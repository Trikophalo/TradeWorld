"use client";

import { BALANCE } from "@/config/balance";
import { useClock } from "@/lib/use-now";

const cfg = BALANCE.newsShow;

/**
 * Whether the hourly news show is on or about to start, from the clock alone (ADR-150): "live" from the full hour
 * for as long as a show may start or run, "soon" in the minutes before. Marks the News tab.
 */
export function useShowWindow(): "live" | "soon" | null {
  const now = useClock();
  if (now === null) return null;
  const minute = (now % 3_600_000) / 60_000;
  if (minute < cfg.waitMinutes) return "live";
  if (minute >= 60 - cfg.teaserMinutes) return "soon";
  return null;
}
