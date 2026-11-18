/**
 * Market forces from outside (ADR-214). Stocks have no daily limit any more; instead an overheated stock (price far
 * above its fair value, big gains in 24 hours or 7 days) draws profit taking, short-seller reports, downgrades, audits,
 * corrections and bubble warnings, and a stock far below its fair value draws bargain hunters. Every force moves only
 * the price, never the fair value, so it pulls the price back towards the anchor the value funds trade on.
 *
 * Mirrored in Postgres (supabase/migrations/20261204010900_stock_unbounded.sql: market_force_heat,
 * market_force_chance_per_hour, market_force_pick, market_force_move_bps). Values in src/config/market-forces.ts.
 */
import { BALANCE } from "../../config/balance.ts";
import type { TradingConfig } from "../../config/balance.ts";
import { MARKET_FORCES } from "../../config/market-forces.ts";
import type { MarketForce, MarketForcesConfig } from "../../config/market-forces.ts";
import { bondYieldBps } from "./bonds.ts";
import { initialArchetypeStates } from "./investors.ts";
import { playerStockBandE4 } from "./player-influence.ts";
import { createRng } from "./rng.ts";
import { stepMarketTick } from "./tick.ts";
import type { MarketState, SecurityState, TickShock } from "./types.ts";

export interface HeatInput {
  readonly priceE4: number;
  readonly fairValueE4: number;
  /** Price 24 hours and 7 days ago; null while the stock is younger. */
  readonly price24hE4: number | null;
  readonly price7dE4: number | null;
}

export interface Heat {
  /** How overheated the stock is, 0..maxHeat. */
  readonly heat: number;
  /** How far it fell below its value, 0..maxHeat. */
  readonly cold: number;
}

const excess = (x: number, free: number, scale: number) => Math.max(0, x - free) / scale;
const logRatio = (a: number, b: number | null) => (b !== null && a > 0 && b > 0 ? Math.log(a / b) : 0);

/**
 * Heat and cold of a stock: Σ max(0, ln(ratio) − free) / scale, capped at maxHeat. Gains count only while
 * ln(price / fair value) ≥ −gainGate.
 */
export function stockHeat(input: HeatInput, cfg: MarketForcesConfig["heat"] = MARKET_FORCES.heat): Heat {
  const premium = input.fairValueE4 > 0 ? logRatio(input.priceE4, input.fairValueE4) : 0;
  const g24 = logRatio(input.priceE4, input.price24hE4);
  const g7 = logRatio(input.priceE4, input.price7dE4);
  // gains only count while the price is not clearly below its fair value: a rise the company earned is no bubble
  const gains =
    premium >= -cfg.gainGate
      ? excess(g24, cfg.gain24hFree, cfg.gain24hScale) + excess(g7, cfg.gain7dFree, cfg.gain7dScale)
      : 0;
  const heat = excess(premium, cfg.premiumFree, cfg.premiumScale) + gains;
  const cold = excess(-premium, cfg.discountFree, cfg.discountScale) + excess(-g24, cfg.loss24hFree, cfg.loss24hScale);
  return { heat: Math.min(cfg.maxHeat, heat), cold: Math.min(cfg.maxHeat, cold) };
}

/** Chance per hour that a single force hits the stock. */
export function forceChancePerHour(h: Heat, cfg: MarketForcesConfig["chance"] = MARKET_FORCES.chance): number {
  return Math.min(cfg.maxPerHour, cfg.basePerHour + cfg.perHeatPerHour * h.heat + cfg.perColdPerHour * h.cold);
}

/** Chance per minute (the server checks once a minute) from a chance per hour: 1 − e^(−rate / 60). */
export function perMinute(perHour: number): number {
  return 1 - Math.exp(-Math.max(0, perHour) / 60);
}

/**
 * Weight of a force for a stock: hot forces × heat (from minHeat), cold forces × cold, background forces as is, but
 * never one that pushes a hot stock further up or a cold one further down.
 */
export function forceWeight(force: MarketForce, h: Heat): number {
  if (force.when === "hot") return h.heat > 0 && h.heat >= force.minHeat ? force.weight * h.heat : 0;
  if (force.when === "cold") return force.weight * h.cold;
  if ((h.heat > 0 && force.direction > 0) || (h.cold > 0 && force.direction < 0)) return 0;
  return force.weight;
}

/** The force for a uniform draw u in [0, 1), in config order; null when no force has weight. */
export function pickForce(
  h: Heat,
  u: number,
  forces: readonly MarketForce[] = MARKET_FORCES.forces,
): MarketForce | null {
  const weights = forces.map((f) => forceWeight(f, h));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let x = u * total;
  for (let i = 0; i < forces.length; i++) {
    x -= weights[i]!;
    if (x < 0 && weights[i]! > 0) return forces[i]!;
  }
  for (let i = forces.length - 1; i >= 0; i--) if (weights[i]! > 0) return forces[i]!;
  return null;
}

/** Size of the move (positive bps): uniform(min, max) × (1 + severityPerHeat × heat or cold), at most maxMoveBps. */
export function forceMoveBps(
  force: { readonly direction: number; readonly minMoveBps: number; readonly maxMoveBps: number },
  h: Heat,
  u: number,
  cfg: Pick<MarketForcesConfig, "severityPerHeat" | "maxMoveBps"> = MARKET_FORCES,
): number {
  const base = force.minMoveBps + u * (force.maxMoveBps - force.minMoveBps);
  const level = force.direction < 0 ? h.heat : h.cold;
  return Math.max(1, Math.min(cfg.maxMoveBps, Math.round(base * (1 + cfg.severityPerHeat * level))));
}

/** Change of the mood (sentiment) that comes with a move of `signedMoveBps`, within [-1, 1]. */
export function forceSentimentDelta(
  signedMoveBps: number,
  cfg: Pick<MarketForcesConfig, "sentimentPerMove"> = MARKET_FORCES,
): number {
  return Math.max(-1, Math.min(1, (signedMoveBps / 10_000) * cfg.sentimentPerMove));
}

/** Strength 1..3 shown in the news (leicht, spürbar, deutlich). */
export function forceStrength(moveBps: number): 1 | 2 | 3 {
  return moveBps < 800 ? 1 : moveBps < 1_600 ? 2 : 3;
}

/** Chance per hour of a wave (several stocks at once) from the mean heat of the hot stocks. */
export function waveChancePerHour(meanHeat: number, cfg: MarketForcesConfig["waves"] = MARKET_FORCES.waves): number {
  if (meanHeat <= 0) return 0;
  return Math.min(cfg.maxPerHour, cfg.basePerHour + cfg.perHeatPerHour * meanHeat);
}

/** Size of a wave's move for one stock: 300..1.000 bps × (1 + severityPerHeat × heat), at most maxMoveBps. */
export function waveMoveBps(h: Heat, u: number, direction: 1 | -1, cfg = MARKET_FORCES): number {
  return forceMoveBps({ direction, minMoveBps: 300, maxMoveBps: 1_000 }, h, u, cfg);
}

// ------------------------------------------------------------------------------------------- price path harness

export interface StockPathOptions {
  readonly days: number;
  /** Fair value growth per quarter (6 hours), e.g. 0.05 = +5 % (company growth). */
  readonly fairGrowthPerQuarter: number;
  /** Player buying that does not care about the price (cents per hour). */
  readonly steadyBuyCentsPerHour: number;
  /** Player buying that chases the trend: × tanh(trend / 0,02), negative when the trend turns (cents per hour). */
  readonly chaseBuyCentsPerHour: number;
  /** Daily band in bps (the old ADR-170 rule: 10.000), 0 = none. */
  readonly dailyBandBps: number;
  /** Market forces on or off. */
  readonly forces: boolean;
}

export interface StockPath {
  /** Gain (ratio − 1) of every full day. */
  readonly dayGains: number[];
  /** Gain of every full week. */
  readonly weekGains: number[];
  /** Price / fair value at the end. */
  readonly endPremium: number;
  /** Largest single-day gain. */
  readonly maxDayGain: number;
  /** Number of forces that hit (came true). */
  readonly forcesHit: number;
}

/**
 * Simulates one hot player stock (penny, 1 € at its fair value) with the real tick engine: the fair value grows every
 * quarter, players buy steadily and chase the trend, optionally the old daily band, optionally the market forces (with
 * lead and reliability, single forces and waves, as on the server). Pure: randomness only from the seed.
 */
export function simulateStockPath(opts: StockPathOptions, seed: number, cfg = MARKET_FORCES): StockPath {
  const rng = createRng(seed);
  const forceRng = rng.derive("forces");
  const flowRng = rng.derive("flows");
  const ticksPerMinute = 60 / BALANCE.time.tickSeconds;
  const ticksPerQuarter = BALANCE.time.quarterHours * 60 * ticksPerMinute;
  const minutesPerDay = 24 * 60;
  const totalMinutes = opts.days * minutesPerDay;
  const band: TradingConfig["playerStocks"] = { insiderCooldownHours: 0, dailyBandBps: opts.dailyBandBps };

  let fair = 10_000;
  const freeFloat = 4_000_000;
  const rate = BALANCE.centralBank.startRateBps;
  const hot: SecurityState = {
    id: "HOT",
    sectorId: "tech",
    sizeClass: "penny",
    priceE4: BigInt(fair),
    fairValueE4: BigInt(fair),
    sharesOutstanding: BigInt(freeFloat * 2),
    freeFloatShares: BigInt(freeFloat),
    sentiment: 0,
    emaFastE4: fair,
    emaSlowE4: fair,
    dividendYieldBps: 0,
    inIndex: false,
    halted: false,
    archetypes: initialArchetypeStates({
      freeFloatShares: freeFloat,
      policyRateBps: rate,
      dividendYieldBps: 0,
      bondYieldBps: bondYieldBps(rate, 10),
      inIndex: false,
    }),
  };
  let state: MarketState = { tick: 0, securities: [hot] };
  const minutePrices: number[] = [fair];
  let prevClose = fair;
  let pending: { dueMinute: number; moves: number; hit: boolean } | null = null;
  let forcesHit = 0;
  let maxDayGain = -1;

  for (let minute = 0; minute < totalMinutes; minute++) {
    const sec = state.securities[0]!;
    const price = Number(sec.priceE4);
    const shocks: TickShock[] = [];
    if (opts.forces) {
      if (pending && pending.dueMinute <= minute) {
        if (pending.hit) {
          shocks.push({
            securityId: "HOT",
            priceReturn: pending.moves / 10_000,
            sentimentDelta: forceSentimentDelta(pending.moves, cfg),
          });
          forcesHit++;
        }
        pending = null;
      }
      if (!pending) {
        const at = (m: number) => (minute - m >= 0 ? minutePrices[minute - m]! : null);
        const h = stockHeat(
          { priceE4: price, fairValueE4: fair, price24hE4: at(1_440), price7dE4: at(10_080) },
          cfg.heat,
        );
        const lead = () => Math.round(cfg.leadMinMinutes + forceRng.next() * (cfg.leadMaxMinutes - cfg.leadMinMinutes));
        const hit = () => forceRng.next() * 10_000 < cfg.reliabilityBps;
        if (forceRng.next() < perMinute(forceChancePerHour(h, cfg.chance))) {
          const force = pickForce(h, forceRng.next(), cfg.forces);
          if (force) {
            const move = forceMoveBps(force, h, forceRng.next(), cfg);
            pending = { dueMinute: minute + lead(), moves: force.direction * move, hit: hit() };
          }
        } else if (h.heat >= cfg.waves.minHeat && forceRng.next() < perMinute(waveChancePerHour(h.heat, cfg.waves))) {
          pending = { dueMinute: minute + lead(), moves: -waveMoveBps(h, forceRng.next(), -1, cfg), hit: hit() };
        }
      }
    }
    for (let t = 0; t < ticksPerMinute; t++) {
      const s = state.securities[0]!;
      const p = Number(s.priceE4);
      const trend = s.emaSlowE4 > 0 ? s.emaFastE4 / s.emaSlowE4 - 1 : 0;
      const perTick = 1 / (60 * ticksPerMinute);
      const cents =
        (opts.steadyBuyCentsPerHour + opts.chaseBuyCentsPerHour * Math.tanh(trend / 0.02)) *
        perTick *
        (0.5 + flowRng.next());
      const shares = Math.round((cents * 100) / Math.max(1, p));
      const result = stepMarketTick(
        state,
        {
          nowMs: (minute * ticksPerMinute + t) * BALANCE.time.tickSeconds * 1000,
          session: "open",
          policyRateBps: rate,
          playerFlows:
            shares !== 0
              ? [{ securityId: "HOT", netShares: BigInt(shares), volumeShares: BigInt(Math.abs(shares)) }]
              : [],
          shocks: t === 0 ? shocks : [],
        },
        rng,
      );
      state = result.state;
      if (opts.dailyBandBps > 0) {
        const n = state.securities[0]!;
        const clamped = playerStockBandE4(Number(n.priceE4), prevClose, band);
        if (clamped !== Number(n.priceE4)) state = { ...state, securities: [{ ...n, priceE4: BigInt(clamped) }] };
      }
      if (state.tick % ticksPerQuarter === 0) {
        fair = Math.round(fair * (1 + opts.fairGrowthPerQuarter));
        const n = state.securities[0]!;
        state = { ...state, securities: [{ ...n, fairValueE4: BigInt(fair) }] };
      }
    }
    const close = Number(state.securities[0]!.priceE4);
    minutePrices.push(close);
    if ((minute + 1) % minutesPerDay === 0) {
      maxDayGain = Math.max(maxDayGain, close / prevClose - 1);
      prevClose = close;
    }
  }
  const dayGains: number[] = [];
  for (let d = minutesPerDay; d < minutePrices.length; d += minutesPerDay) {
    dayGains.push(minutePrices[d]! / minutePrices[d - minutesPerDay]! - 1);
  }
  const weekGains: number[] = [];
  for (let w = 7 * minutesPerDay; w < minutePrices.length; w += 7 * minutesPerDay) {
    weekGains.push(minutePrices[w]! / minutePrices[w - 7 * minutesPerDay]! - 1);
  }
  return {
    dayGains,
    weekGains,
    endPremium: minutePrices[minutePrices.length - 1]! / fair,
    maxDayGain,
    forcesHit,
  };
}

/** The p-quantile (0..1) of a list of numbers (nearest rank). */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}
