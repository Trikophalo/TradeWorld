/**
 * The six AI investor archetypes (spec 5.3) as aggregated net order flow (ADR-005).
 *
 * `computeInvestorPressure` returns the net number of shares one archetype wants
 * to buy (positive) or sell (negative) in one security during one tick. The
 * tick converts the sum of all pressures into a return via the price-impact
 * function.
 *
 * Two families:
 * - flow types (value fund, momentum trader, retail herd): pressure is
 *   `freeFloat x capitalShare x reactionSpeed x signal`, signal in [-1, 1]
 * - stock types (pension fund, index fund, market maker): pressure closes a
 *   fraction `reactionSpeed` of the gap between target and current holding
 */
import { BALANCE } from "../../config/balance.ts";
import type {
  AiInvestorsConfig,
  CentralBankConfig,
  InvestorArchetypeId,
  TradingConfig,
} from "../../config/balance.ts";
import type { ArchetypeStates, InvestorPressures } from "./types.ts";
import { INVESTOR_ARCHETYPES } from "./types.ts";

export interface InvestorSignals {
  /** Current price and fair value in the same unit (E4 as number). */
  readonly price: number;
  readonly fairValue: number;
  readonly emaFast: number;
  readonly emaSlow: number;
  /** Sentiment in [-1, 1] after decay and shocks of this tick. */
  readonly sentiment: number;
  readonly freeFloatShares: number;
  readonly policyRateBps: number;
  readonly dividendYieldBps: number;
  /** Yield of the 10-year government bond. */
  readonly bondYieldBps: number;
  readonly inIndex: boolean;
  /**
   * Session liquidity relative to market hours (1 = open, 0.25 = after hours).
   * AI investors scale their activity with it, so thin after-hours books do not
   * amplify their own flow; only player orders move prices more after hours.
   */
  readonly liquidityFactor: number;
  /** Current holding of the archetype in question (market maker: inventory after this tick's player flow). */
  readonly holdingShares: number;
}

export interface InvestorConfig {
  readonly ai: AiInvestorsConfig;
  readonly centralBank: CentralBankConfig;
  readonly priceImpact: TradingConfig["priceImpact"];
}

const DEFAULT_INVESTOR_CONFIG: InvestorConfig = {
  ai: BALANCE.aiInvestors,
  centralBank: BALANCE.centralBank,
  priceImpact: BALANCE.trading.priceImpact,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function param(params: Readonly<Record<string, number>>, key: string, fallback: number): number {
  const value = params[key];
  return value === undefined ? fallback : value;
}

/** Relative trend: fast EMA against slow EMA. */
export function trendSignal(emaFast: number, emaSlow: number): number {
  return emaSlow > 0 ? emaFast / emaSlow - 1 : 0;
}

/** Target equity weight of the pension fund relative to its baseline (1 = neutral). */
export function pensionTargetWeight(
  policyRateBps: number,
  dividendYieldBps: number,
  bondYieldBps: number,
  cfg: InvestorConfig = DEFAULT_INVESTOR_CONFIG,
): number {
  const p = cfg.ai.archetypes.pension_fund.params;
  const rate = param(p, "rateSensitivityPer100Bps", 0) * ((policyRateBps - cfg.centralBank.neutralRateBps) / 100);
  const tilt = param(p, "yieldTiltPer100Bps", 0) * ((dividendYieldBps - bondYieldBps) / 100);
  return clamp(1 + rate + tilt, param(p, "minWeight", 0), param(p, "maxWeight", 2));
}

/** Target holding in shares for the stock-type archetypes, `null` for flow types. */
export function targetHoldingShares(
  archetype: InvestorArchetypeId,
  signals: InvestorSignals,
  cfg: InvestorConfig = DEFAULT_INVESTOR_CONFIG,
): number | null {
  const base = signals.freeFloatShares * cfg.ai.archetypes[archetype].capitalShare;
  switch (archetype) {
    case "market_maker":
      return 0;
    case "pension_fund":
      return base * pensionTargetWeight(signals.policyRateBps, signals.dividendYieldBps, signals.bondYieldBps, cfg);
    case "index_fund":
      // A cap-weighted index fund holds the same fraction of every member's free float.
      return signals.inIndex ? base : 0;
    default:
      return null;
  }
}

/**
 * Net pressure in shares of one archetype for one security in one tick.
 * Deterministic: all randomness of a tick lives in the noise term of `stepMarketTick`.
 */
export function computeInvestorPressure(
  archetype: InvestorArchetypeId,
  signals: InvestorSignals,
  cfg: InvestorConfig = DEFAULT_INVESTOR_CONFIG,
): number {
  const a = cfg.ai.archetypes[archetype];
  const speed = a.reactionSpeed * signals.liquidityFactor;
  const flowCapacity = signals.freeFloatShares * a.capitalShare * speed;

  switch (archetype) {
    case "market_maker": {
      // Unwinds inventory taken from players. Only the hedged share hits the
      // market, the rest is absorbed by natural counter flow.
      return -signals.holdingShares * speed * cfg.priceImpact.marketMakerHedgeShare;
    }
    case "value_fund": {
      // Buys below fair value, sells above, ignores small gaps, reacts slowly.
      if (signals.price <= 0 || signals.fairValue <= 0) return 0;
      const gap = Math.log(signals.fairValue / signals.price);
      const deadBand = param(a.params, "deadBand", 0);
      if (Math.abs(gap) <= deadBand) return 0;
      const effective = gap - Math.sign(gap) * deadBand;
      return flowCapacity * clamp(effective / param(a.params, "gapScale", 0.5), -1, 1);
    }
    case "momentum_trader": {
      // Jumps on trends and amplifies them.
      const trend = trendSignal(signals.emaFast, signals.emaSlow);
      return flowCapacity * Math.tanh(trend / param(a.params, "trendScale", 0.01));
    }
    case "retail_herd": {
      // Emotional: follows news sentiment and chases recent moves.
      const trend = trendSignal(signals.emaFast, signals.emaSlow);
      const chase = param(a.params, "chaseGain", 0) * Math.tanh(trend / param(a.params, "trendScale", 0.01));
      return flowCapacity * clamp(signals.sentiment + chase, -1, 1);
    }
    case "pension_fund":
    case "index_fund": {
      const target = targetHoldingShares(archetype, signals, cfg) ?? 0;
      return (target - signals.holdingShares) * speed;
    }
  }
}

/** Pressure of all six archetypes. `holdings` supplies the per-archetype holding. */
export function computeAllPressures(
  signals: Omit<InvestorSignals, "holdingShares">,
  holdings: Readonly<Record<InvestorArchetypeId, number>>,
  cfg: InvestorConfig = DEFAULT_INVESTOR_CONFIG,
): InvestorPressures {
  const result = {} as Record<InvestorArchetypeId, number>;
  for (const archetype of INVESTOR_ARCHETYPES) {
    result[archetype] = computeInvestorPressure(archetype, { ...signals, holdingShares: holdings[archetype] }, cfg);
  }
  return result;
}

/**
 * Starting holdings for a newly listed or seeded security: stock types start at
 * their target (no artificial start-up flows), flow types and the market maker at 0.
 * Flow-type holdings are bookkeeping of the net position against their baseline
 * and may become negative.
 */
export function initialArchetypeStates(
  signals: Pick<InvestorSignals, "freeFloatShares" | "policyRateBps" | "dividendYieldBps" | "bondYieldBps" | "inIndex">,
  cfg: InvestorConfig = DEFAULT_INVESTOR_CONFIG,
): ArchetypeStates {
  const full: InvestorSignals = {
    ...signals,
    price: 1,
    fairValue: 1,
    emaFast: 1,
    emaSlow: 1,
    sentiment: 0,
    liquidityFactor: 1,
    holdingShares: 0,
  };
  const result = {} as Record<InvestorArchetypeId, { holdingShares: number }>;
  for (const archetype of INVESTOR_ARCHETYPES) {
    const target = archetype === "market_maker" ? 0 : targetHoldingShares(archetype, full, cfg);
    result[archetype] = { holdingShares: target ?? 0 };
  }
  return result;
}
