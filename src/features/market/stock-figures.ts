import type { StockFigures } from "@/features/game/types";

export type RevenueTrend = "up" | "down" | "flat";

/**
 * Trend arrow of the business figures at the stock exchange (ADR-184): this day (or quarter) against the one before.
 * The server already scales the previous day to the same number of closed hours. Null without a previous period.
 */
export function revenueTrend(f: Pick<StockFigures, "revenueCents" | "prevRevenueCents">): RevenueTrend | null {
  if (f.prevRevenueCents == null) return null;
  if (f.revenueCents > f.prevRevenueCents) return "up";
  if (f.revenueCents < f.prevRevenueCents) return "down";
  return "flat";
}
