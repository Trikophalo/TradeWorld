/**
 * Valuation of listed player companies (ADR-217): the fair value per share the value fund pulls a player stock to.
 *
 * Before, the fair value was the company value (ADR-067/167): cash − open bills + 4 × last quarter's profit × sector
 * P/E × 0,5, set at every quarter close. The company keeps its profit as cash, so the cash and with it the fair value
 * rose every quarter by one quarter's profit (≈ 3 % of the value; a game year is one real day). Every player stock
 * tracked a line that only went up.
 *
 * Now (once a minute, server: player_stock_valuation_run):
 *   value = counted cash + expected yearly profit × sector P/E × peDiscount × multiple
 *   expected yearly profit = operating profit of the last `profitHours` hours (one game year), scaled up while the
 *                            company has fewer hours
 *   multiple = growth × mood × sector cycle, clamped to [minMultiple, maxMultiple]
 *     growth       = e^clamp(perLogGrowth × ln(profit of the last game year / the one before), ±maxLog):
 *                    expected growth is priced in at once; when growth slows the multiple contracts
 *     mood         = e^(perPoint × (market mood − 50)): bear phases cut every player stock's multiple
 *     sector cycle = e^(amplitude × sin(2π (hours / periodHours + phase))): sector P/E cycles of a few days
 *   counted cash = min(cash, reserve) + excessCashWeight × (cash − reserve), reserve = max(anchor,
 *                  reserveYears × expected yearly profit). The anchor is the free cash when the stock was first valued
 *                  this way (or listed) plus money from capital increases; it only shrinks when the cash does. Cash the
 *                  company piles up on top hardly counts: investors already pay for that profit in the multiple.
 *   floor: liquidationWeight × cash (a cash-rich company is never valued below a fifth of its cash).
 * The fair value per share is value / shares × the reputation factor (ADR-167). Shocks that move the fair value
 * outside this model (crises ADR-091, market events) fade with shockHalfLifeHours.
 *
 * Formulas in src/lib/sim/player-valuation.ts, mirrored in Postgres
 * (supabase/migrations/20261204011200_player_stock_valuation.sql). Plain data, no imports
 * (part of BALANCE as "playerValuation").
 */
export const PLAYER_VALUATION = {
  /** Hours of operating profit that make up the expected yearly profit (one game year = 24 hours). */
  profitHours: 24,
  /** A younger company is scaled up from at least this many hours. */
  minProfitHours: 6,
  /** Growth expectation: ln(profit of the last game year / the one before) × perLogGrowth, at most ±maxLog. */
  growth: { perLogGrowth: 0.8, maxLog: 0.4 },
  /** Market mood (ADR-216): e^(perPoint × (mood − 50)); bear (28) ≈ × 0,80, bull (68) ≈ × 1,2. */
  mood: { perPoint: 0.01 },
  /** Sector P/E cycles: e^(amplitude × sin(2π (hours since 1970 / periodHours + phase))). */
  sectorCycle: {
    amplitude: 0.25,
    sectors: {
      tech: { periodHours: 83, phase: 0.1 },
      retail: { periodHours: 131, phase: 0.55 },
      energy: { periodHours: 107, phase: 0.3 },
      pharma: { periodHours: 149, phase: 0.8 },
      logistics: { periodHours: 97, phase: 0.65 },
    } as Readonly<Record<string, { readonly periodHours: number; readonly phase: number }>>,
    /** Sectors without an entry. */
    fallback: { periodHours: 113, phase: 0.45 },
  },
  minMultiple: 0.45,
  maxMultiple: 2,
  /** Cash counted at 1× up to the reserve: max(anchor, reserveYears × expected yearly profit). */
  reserveYears: 0.5,
  /** Cash above the reserve counts this much. */
  excessCashWeight: 0.03,
  /** The value is never below this share of the free cash. */
  liquidationWeight: 0.2,
  /** Changes of the fair value from outside the model (crisis shocks, market events) fade with this half-life. */
  shockHalfLifeHours: 3,
} as const;

export type PlayerValuationConfig = typeof PLAYER_VALUATION;
