/**
 * Popular stocks first (ADR-145). The market list ranks stocks by how often players open them and how much they
 * invest. The database computes the same score in `security_popularity_score()`; the demo and tests use this one.
 */
import { BALANCE } from "../../config/balance.ts";
import type { MarketPopularityConfig } from "../../config/balance.ts";

/**
 * score = views × view + investors × investor + floor(√(bought euros) × volume)
 * The square root keeps one big buyer from outweighing many small ones.
 */
export function popularityScore(
  views: number,
  investors: number,
  boughtCents: number,
  cfg: MarketPopularityConfig = BALANCE.marketPopularity,
): number {
  const euros = Math.max(0, Math.floor(boughtCents / 100));
  return (
    Math.max(0, views) * cfg.weights.view +
    Math.max(0, investors) * cfg.weights.investor +
    Math.floor(Math.sqrt(euros) * cfg.weights.volume)
  );
}

/** Whether a view counts: the first one, or the first after the pause since the last counted one. */
export function viewCounts(
  lastCountedAt: number | null,
  now: number,
  cfg: MarketPopularityConfig = BALANCE.marketPopularity,
): boolean {
  return lastCountedAt === null || now - lastCountedAt >= cfg.viewCooldownMinutes * 60_000;
}

export interface RankedStock {
  name: string;
  popularity: number;
  marketCapCents: number | null;
}

/** Most popular first; on a tie the bigger company, then the name. */
export function comparePopularity(a: RankedStock, b: RankedStock): number {
  return (
    b.popularity - a.popularity ||
    (b.marketCapCents ?? 0) - (a.marketCapCents ?? 0) ||
    a.name.localeCompare(b.name, "de")
  );
}
