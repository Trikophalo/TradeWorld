/**
 * Valuation of listed player companies (ADR-217): fair value from expected profit × a multiple that breathes with
 * growth expectations, the market mood and sector P/E cycles; piled-up cash hardly counts. Values in
 * src/config/player-valuation.ts, mirrored in Postgres (supabase/migrations/20261204011200_player_stock_valuation.sql).
 * Pure: time is passed in.
 */
import { PLAYER_VALUATION } from "../../config/player-valuation.ts";
import type { PlayerValuationConfig } from "../../config/player-valuation.ts";

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Expected yearly profit (cents, ≥ 0): profit of the observed hours scaled to profitHours. */
export function expectedYearlyProfit(
  profitCents: number,
  hours: number,
  cfg: PlayerValuationConfig = PLAYER_VALUATION,
): number {
  if (hours <= 0) return 0;
  return Math.max(0, (profitCents * cfg.profitHours) / Math.max(hours, cfg.minProfitHours));
}

/**
 * Growth expectation: log ratio of the average hourly profit of the last game year to the one before. Unknown prior
 * (younger company): 0. A swing from loss to profit (or back) counts as a full step (±10, clamped later).
 */
export function growthLog(recentPerHour: number, priorPerHour: number | null): number {
  if (priorPerHour === null) return 0;
  if (recentPerHour > 0 && priorPerHour > 0) return Math.log(recentPerHour / priorPerHour);
  if (recentPerHour > priorPerHour) return 10;
  if (recentPerHour < priorPerHour) return -10;
  return 0;
}

/** Multiple part from the growth expectation: e^clamp(perLogGrowth × g, ±maxLog). */
export function growthFactor(g: number, cfg: PlayerValuationConfig["growth"] = PLAYER_VALUATION.growth): number {
  return Math.exp(clamp(cfg.perLogGrowth * g, -cfg.maxLog, cfg.maxLog));
}

/** Multiple part from the market mood (0..100): e^(perPoint × (mood − 50)). */
export function moodFactor(mood: number, cfg: PlayerValuationConfig["mood"] = PLAYER_VALUATION.mood): number {
  return Math.exp(cfg.perPoint * (clamp(mood, 0, 100) - 50));
}

/** Multiple part from the sector P/E cycle at `hours` (hours since 1970-01-01 UTC). */
export function sectorCycleFactor(
  sector: string,
  hours: number,
  cfg: PlayerValuationConfig["sectorCycle"] = PLAYER_VALUATION.sectorCycle,
): number {
  const s = cfg.sectors[sector] ?? cfg.fallback;
  return Math.exp(cfg.amplitude * Math.sin(2 * Math.PI * (hours / s.periodHours + s.phase)));
}

/** Cash the investors count: 1× up to the reserve, excessCashWeight above, all of it when negative. */
export function countedCash(
  cashCents: number,
  anchorCents: number,
  yearlyProfitCents: number,
  cfg: PlayerValuationConfig = PLAYER_VALUATION,
): number {
  if (cashCents <= 0) return cashCents;
  const reserve = Math.max(anchorCents, cfg.reserveYears * Math.max(0, yearlyProfitCents));
  return Math.min(cashCents, reserve) + cfg.excessCashWeight * Math.max(0, cashCents - reserve);
}

export interface PlayerValuationInput {
  /** Operating profit of the last profitHours hours and how many hours of it exist. */
  readonly profitRecentCents: number;
  readonly hoursRecent: number;
  /** Operating profit of the profitHours hours before (null while the company has fewer hours). */
  readonly profitPriorCents: number | null;
  readonly hoursPrior: number;
  /** Free cash: company cash − open bills. */
  readonly cashCents: number;
  readonly anchorCents: number;
  readonly sector: string;
  /** Sector P/E (BALANCE.sectors[…].peRatio) and the start-up discount (startups.valuationPeDiscount). */
  readonly peRatio: number;
  readonly peDiscount: number;
  /** Market mood 0..100 (ADR-216). */
  readonly mood: number;
  /** Hours since 1970-01-01 UTC. */
  readonly hours: number;
}

export interface PlayerValuation {
  readonly valueCents: number;
  readonly yearlyProfitCents: number;
  readonly countedCashCents: number;
  readonly growth: number;
  readonly mood: number;
  readonly cycle: number;
  readonly multiple: number;
}

/** Value of a listed player company (cents, ≥ 0). */
export function playerCompanyValue(
  input: PlayerValuationInput,
  cfg: PlayerValuationConfig = PLAYER_VALUATION,
): PlayerValuation {
  const yearly = expectedYearlyProfit(input.profitRecentCents, input.hoursRecent, cfg);
  const growth = growthFactor(
    growthLog(
      input.profitRecentCents / Math.max(1, input.hoursRecent),
      input.profitPriorCents === null ? null : input.profitPriorCents / Math.max(1, input.hoursPrior),
    ),
    cfg.growth,
  );
  const mood = moodFactor(input.mood, cfg.mood);
  const cycle = sectorCycleFactor(input.sector, input.hours, cfg.sectorCycle);
  const multiple = clamp(growth * mood * cycle, cfg.minMultiple, cfg.maxMultiple);
  const cash = countedCash(input.cashCents, input.anchorCents, yearly, cfg);
  const value = Math.max(
    0,
    cfg.liquidationWeight * input.cashCents,
    cash + yearly * input.peRatio * input.peDiscount * multiple,
  );
  return { valueCents: value, yearlyProfitCents: yearly, countedCashCents: cash, growth, mood, cycle, multiple };
}

/** Fair value per share (e4) from the company value, the shares and the reputation factor (ADR-167). */
export function playerFairValueE4(valueCents: number, shares: number, priceFactor = 1): number {
  return Math.max(1, Math.round(((valueCents * 100) / Math.max(1, shares)) * priceFactor));
}

/** A shock factor from outside the model fades towards 1 with shockHalfLifeHours. */
export function fadeShock(factor: number, minutes: number, cfg: PlayerValuationConfig = PLAYER_VALUATION): number {
  if (!(factor > 0)) return 1;
  return Math.exp(Math.log(factor) * Math.pow(0.5, Math.max(0, minutes) / 60 / cfg.shockHalfLifeHours));
}

/**
 * The cash anchor after a run: never above the free cash (spent or withdrawn money is gone), plus the cash a capital
 * increase brought in (shares went up: the rise of the cash since the last run).
 */
export function nextAnchor(anchorCents: number, cashCents: number, lastCashCents: number, sharesGrew: boolean): number {
  const raised = sharesGrew ? Math.max(0, cashCents - lastCashCents) : 0;
  return Math.max(0, Math.min(anchorCents + raised, Math.max(0, cashCents)));
}

/** The old fair value (ADR-067/167): cash + 4 × quarter profit × P/E × discount (for the harness and the ADR). */
export function legacyCompanyValue(
  cashCents: number,
  quarterProfitCents: number,
  peRatio: number,
  peDiscount: number,
): number {
  return Math.max(0, cashCents + Math.round(4 * Math.max(0, quarterProfitCents) * peRatio * peDiscount));
}
