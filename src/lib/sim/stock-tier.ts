/**
 * Stock tiers of listed player companies (ADR-218): penny → smallcap → midcap → largecap → bluechip by market cap,
 * with hysteresis (falls back only below downBps of the own rung's threshold) and a minimum time between two changes.
 * Mirrored in Postgres (supabase/migrations/20261204011320_player_stock_tiers.sql). Pure: time is passed in.
 */
import { BALANCE } from "../../config/balance.ts";
import type { SizeClass, TradingConfig } from "../../config/balance.ts";

export type StockTiersConfig = TradingConfig["playerStockTiers"];

/** Rung index of a tier on the ladder; tiers not on the ladder (none today) count as the bottom rung. */
export function tierRung(tier: SizeClass | null, cfg: StockTiersConfig = BALANCE.trading.playerStockTiers): number {
  const i = cfg.ladder.findIndex((r) => r.tier === tier);
  return i < 0 ? 0 : i;
}

/**
 * The tier after a check. Up: the highest rung whose threshold the market cap reaches (several rungs at once after a
 * jump). Down: one rung at a time, only below downBps of the own threshold. Within minHoursBetweenChanges of the last
 * change nothing moves (null hours = never changed).
 */
export function nextStockTier(
  current: SizeClass | null,
  marketCapCents: number,
  hoursSinceChange: number | null,
  cfg: StockTiersConfig = BALANCE.trading.playerStockTiers,
): SizeClass {
  const rung = tierRung(current, cfg);
  const cur = cfg.ladder[rung]!.tier;
  if (current !== null && hoursSinceChange !== null && hoursSinceChange < cfg.minHoursBetweenChanges) return cur;
  let up = rung;
  while (up + 1 < cfg.ladder.length && marketCapCents >= cfg.ladder[up + 1]!.minMarketCapCents) up++;
  if (up > rung) return cfg.ladder[up]!.tier;
  if (rung > 0 && marketCapCents < (cfg.ladder[rung]!.minMarketCapCents * cfg.downBps) / 10_000) {
    return cfg.ladder[rung - 1]!.tier;
  }
  return cur;
}

export interface StockTierProgress {
  readonly tier: SizeClass;
  readonly rung: number;
  readonly rungs: number;
  readonly next: SizeClass | null;
  /** Market cap the next rung needs (null at the top). */
  readonly nextAtCents: number | null;
  /** Share of the way from the own threshold to the next one, 0..1 (1 at the top). */
  readonly share: number;
  /** Below this market cap the stock falls back one rung (null at the bottom). */
  readonly downAtCents: number | null;
}

/** Where a stock stands on the ladder, for the badge and the progress bar. */
export function stockTierProgress(
  tier: SizeClass | null,
  marketCapCents: number,
  cfg: StockTiersConfig = BALANCE.trading.playerStockTiers,
): StockTierProgress {
  const rung = tierRung(tier, cfg);
  const own = cfg.ladder[rung]!;
  const next = cfg.ladder[rung + 1] ?? null;
  const share = next
    ? Math.min(
        1,
        Math.max(0, (marketCapCents - own.minMarketCapCents) / (next.minMarketCapCents - own.minMarketCapCents)),
      )
    : 1;
  return {
    tier: own.tier,
    rung,
    rungs: cfg.ladder.length,
    next: next?.tier ?? null,
    nextAtCents: next?.minMarketCapCents ?? null,
    share,
    downAtCents: rung > 0 ? Math.round((own.minMarketCapCents * cfg.downBps) / 10_000) : null,
  };
}
