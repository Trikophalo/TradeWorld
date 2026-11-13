/**
 * Cryptocurrencies (ADR-101): liquidity pools, price moves, events and own coins. The database applies the same rules
 * (game_config.crypto); the demo and the UI use these functions.
 *
 * Units: pool cash in cents (bigint), coins in millionths (E6, bigint), prices in E4 (1 € = 10 000).
 * price_e4 = cash_cents · 10^8 / tokens_e6.
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig } from "../../config/balance.ts";
import type { CoinActionConfig, CoinCategory, CoinEventConfig, CryptoRegime } from "../../config/crypto.ts";
import { divRoundHalfEven, maxBig } from "./money.ts";

const E8 = 100_000_000n;
const BPS = 10_000n;

export interface Pool {
  readonly cashCents: bigint;
  readonly tokensE6: bigint;
}

// ------------------------------------------------------------------ pool

export function poolPriceE4(pool: Pool): bigint {
  if (pool.tokensE6 <= 0n) return 0n;
  return divRoundHalfEven(pool.cashCents * E8, pool.tokensE6);
}

/** A pool holding `cashCents` at `priceE4`. */
export function poolAt(cashCents: bigint, priceE4: bigint): Pool {
  return { cashCents, tokensE6: priceE4 > 0n ? divRoundHalfEven(cashCents * E8, priceE4) : 0n };
}

/** Buy coins for cash: the fee stays in the pool, k = cash · tokens holds for the rest. */
export function swapBuy(pool: Pool, cashInCents: bigint, feeBps: number) {
  const fee = divRoundHalfEven(cashInCents * BigInt(feeBps), BPS);
  const net = cashInCents - fee;
  const k = pool.cashCents * pool.tokensE6;
  const cashAfter = pool.cashCents + net;
  // Round the pool's tokens up, so the pool never gives out more than k allows.
  const tokensAfter = (k + cashAfter - 1n) / cashAfter;
  const tokensOutE6 = maxBig(0n, pool.tokensE6 - tokensAfter);
  return {
    tokensOutE6,
    feeCents: fee,
    pool: { cashCents: cashAfter + fee, tokensE6: pool.tokensE6 - tokensOutE6 } satisfies Pool,
  };
}

/** Sell coins for cash: the fee is kept back from the payout. */
export function swapSell(pool: Pool, tokensInE6: bigint, feeBps: number) {
  const k = pool.cashCents * pool.tokensE6;
  const tokensAfter = pool.tokensE6 + tokensInE6;
  const cashAfter = (k + tokensAfter - 1n) / tokensAfter;
  const gross = maxBig(0n, pool.cashCents - cashAfter);
  const fee = divRoundHalfEven(gross * BigInt(feeBps), BPS);
  return {
    cashOutCents: gross - fee,
    feeCents: fee,
    pool: { cashCents: pool.cashCents - gross + fee, tokensE6: tokensAfter } satisfies Pool,
  };
}

/** Slippage of a buy: how much worse than the current price it fills, in bps. */
export function buySlippageBps(pool: Pool, cashInCents: bigint, feeBps: number): number {
  const before = poolPriceE4(pool);
  const { tokensOutE6 } = swapBuy(pool, cashInCents, feeBps);
  if (tokensOutE6 <= 0n || before <= 0n) return 10_000;
  const avgE4 = divRoundHalfEven(cashInCents * E8, tokensOutE6);
  return Number(divRoundHalfEven((avgE4 - before) * BPS, before));
}

/**
 * The market's trade that moves the price by a log return r (fees ignored): with x · y = k the price goes with the
 * square of the cash, so the cash changes by e^(r/2).
 */
export function flowForReturn(
  pool: Pool,
  r: number,
): { side: "buy"; cashCents: bigint } | { side: "sell"; tokensE6: bigint } {
  const factor = Math.exp(r / 2);
  if (r >= 0) {
    const cash = BigInt(Math.round(Number(pool.cashCents) * (factor - 1)));
    return { side: "buy", cashCents: cash };
  }
  // Selling: tokens go up by 1/factor.
  const tokens = BigInt(Math.round(Number(pool.tokensE6) * (1 / factor - 1)));
  return { side: "sell", tokensE6: tokens };
}

/** Applies the market's trade without fees (the background flow, ADR-101). */
export function applyFlow(pool: Pool, r: number): Pool {
  const flow = flowForReturn(pool, r);
  const k = pool.cashCents * pool.tokensE6;
  if (flow.side === "buy") {
    const cash = pool.cashCents + flow.cashCents;
    return { cashCents: cash, tokensE6: cash > 0n ? k / cash : pool.tokensE6 };
  }
  const tokens = pool.tokensE6 + flow.tokensE6;
  return { cashCents: tokens > 0n ? k / tokens : pool.cashCents, tokensE6: tokens };
}

// ------------------------------------------------------------------ price moves

export function sigmaTick(sigmaDay: number, tickSeconds: number): number {
  return sigmaDay * Math.sqrt(tickSeconds / 86_400);
}

/** Log return of one tick: the market's drift and shock times beta, plus the coin's own shock. */
export function tickReturn(
  input: { sigmaDay: number; beta: number; extraDriftDay?: number },
  regimeDriftDay: number,
  zMarket: number,
  zOwn: number,
  tickSeconds: number,
): number {
  const dt = tickSeconds / 86_400;
  const beta = Math.max(0, input.beta);
  const common = Math.min(1, beta);
  const sigma = sigmaTick(input.sigmaDay, tickSeconds);
  const shock = sigma * (common * zMarket + Math.sqrt(Math.max(0, 1 - common * common)) * zOwn);
  return (beta * regimeDriftDay + (input.extraDriftDay ?? 0)) * dt + shock;
}

/** Stablecoins: pulled back to the peg, a little noise. */
export function stableReturn(
  priceE4: number,
  pegE4: number,
  pegPullPerHour: number,
  sigmaDay: number,
  z: number,
  tickSeconds: number,
): number {
  if (priceE4 <= 0 || pegE4 <= 0) return 0;
  const gap = Math.log(priceE4 / pegE4);
  const pull = 1 - Math.pow(1 - Math.min(1, pegPullPerHour), tickSeconds / 3_600);
  return -gap * pull + sigmaTick(sigmaDay, tickSeconds) * z;
}

export function pickRegime(u: number, cfg: BalanceConfig = BALANCE): CryptoRegime {
  const r = cfg.crypto.regimes;
  const total = r.bull.weight + r.flat.weight + r.bear.weight;
  const x = Math.min(0.999999, Math.max(0, u)) * total;
  if (x < r.bull.weight) return "bull";
  return x < r.bull.weight + r.flat.weight ? "flat" : "bear";
}

export function regimeHours(u: number, cfg: BalanceConfig = BALANCE): number {
  const c = cfg.crypto;
  return Math.round(c.regimeHoursMin + (c.regimeHoursMax - c.regimeHoursMin) * Math.min(1, Math.max(0, u)));
}

// ------------------------------------------------------------------ own coins

export interface CoinStats {
  readonly tech: number;
  readonly hype: number;
  readonly utility: number;
}

const clamp100 = (x: number) => Math.min(100, Math.max(0, x));

/** Daily drift of an own coin from its hype and utility, minus a base selling pressure. */
export function playerCoinDriftDay(stats: CoinStats, cfg: BalanceConfig = BALANCE): number {
  const c = cfg.crypto.create;
  return c.driftPerHype * (stats.hype / 100) + c.driftPerUtility * (stats.utility / 100) + c.driftBase;
}

/** Volatility of an own coin: good technology calms it. */
export function playerCoinSigmaDay(tech: number, cfg: BalanceConfig = BALANCE): number {
  const c = cfg.crypto.create;
  return c.sigmaDay * (1 - c.sigmaTechDamping * (clamp100(tech) / 100));
}

/** Hype fades fast, utility slowly, technology stays. */
export function decayStats(stats: CoinStats, hours: number, cfg: BalanceConfig = BALANCE): CoinStats {
  const c = cfg.crypto.create;
  return {
    tech: stats.tech,
    hype: stats.hype * Math.pow(c.hypeDecayPerHour, Math.max(0, hours)),
    utility: stats.utility * Math.pow(c.utilityDecayPerHour, Math.max(0, hours)),
  };
}

export function applyStats(stats: CoinStats, delta: Partial<CoinStats>): CoinStats {
  return {
    tech: clamp100(stats.tech + (delta.tech ?? 0)),
    hype: clamp100(stats.hype + (delta.hype ?? 0)),
    utility: clamp100(stats.utility + (delta.utility ?? 0)),
  };
}

export function coinAction(key: string, cfg: BalanceConfig = BALANCE): CoinActionConfig | undefined {
  return cfg.crypto.create.actions.find((a) => a.key === key);
}

/** Success chance of an action: base plus IT skill points (always 100 % without a base). */
export function actionSuccessBps(action: CoinActionConfig, itScore: number, cfg: BalanceConfig = BALANCE): number {
  if (action.baseBps === undefined) return 10_000;
  return Math.min(10_000, action.baseBps + Math.max(0, Math.floor(itScore)) * cfg.crypto.create.itBpsPerScore);
}

/**
 * Launch: the creator's liquidity buys nothing, it is the pool's cash; the pool's coins follow from the start price,
 * and the team keeps its share on top (team / (pool + team) = team share).
 */
export function launchPool(liquidityCents: bigint, startPriceE4: bigint, teamShareBps: number) {
  const pool = poolAt(liquidityCents, startPriceE4);
  const share = BigInt(Math.min(9_999, Math.max(0, teamShareBps)));
  const teamTokensE6 = divRoundHalfEven(pool.tokensE6 * share, BPS - share);
  return { pool, teamTokensE6, supplyE6: pool.tokensE6 + teamTokensE6 };
}

/** Selling more than `rugShareBps` of the team tokens within the window is a rug pull. */
export function isRugPull(soldInWindowE6: bigint, teamAtLaunchE6: bigint, cfg: BalanceConfig = BALANCE): boolean {
  if (teamAtLaunchE6 <= 0n) return false;
  return soldInWindowE6 * BPS > teamAtLaunchE6 * BigInt(cfg.crypto.create.rugShareBps);
}

/** Closing a coin: the pool's cash goes to all holders by their coins. */
export function discontinuePayoutCents(poolCashCents: bigint, holderTokensE6: bigint, circulatingE6: bigint): bigint {
  if (circulatingE6 <= 0n) return 0n;
  return (poolCashCents * holderTokensE6) / circulatingE6;
}

// ------------------------------------------------------------------ events

/** Chance per hour of an event for a coin; own coins move it with their stats. */
export function eventChanceBps(event: CoinEventConfig, category: CoinCategory, stats: CoinStats | null): number {
  if (!event.scope.includes(category)) return 0;
  if (category !== "player" || !stats) return event.chanceBps;
  const t = stats.tech / 100;
  const h = stats.hype / 100;
  const u = stats.utility / 100;
  const factor: Record<string, number> = {
    hack: Math.pow(1 - t, 2) * 1.5,
    bug: 1.2 - t,
    influencer: 0.5 + h,
    exchange_listing: 0.4 + (t + u) / 2,
    delisting_rumor: 1.3 - (t + u) / 2,
    whale_buy: 0.5 + h,
    whale_dump: 1,
    partnership: 0.4 + u,
    fud: 1.2 - h / 2,
  };
  return Math.round(event.chanceBps * (factor[event.key] ?? 1));
}

/** One roll per coin and hour: u[0] decides whether, u[1] which event (weighted by chance). */
export function rollCoinEvent(
  u: readonly [number, number],
  category: CoinCategory,
  stats: CoinStats | null,
  cfg: BalanceConfig = BALANCE,
): CoinEventConfig | null {
  const candidates = cfg.crypto.events
    .filter((e) => !e.scope.includes("market"))
    .map((e) => ({ e, w: eventChanceBps(e, category, stats) }))
    .filter((x) => x.w > 0);
  const total = candidates.reduce((s, x) => s + x.w, 0);
  if (total <= 0 || u[0] * 10_000 >= total) return null;
  let x = u[1] * total;
  for (const c of candidates) {
    if (x < c.w) return c.e;
    x -= c.w;
  }
  return candidates.at(-1)!.e;
}

/** Market-wide event of an hour (meme wave, regulation). */
export function rollMarketEvent(u: readonly [number, number], cfg: BalanceConfig = BALANCE): CoinEventConfig | null {
  const market = cfg.crypto.events.filter((e) => e.scope.includes("market"));
  const total = market.reduce((s, e) => s + e.chanceBps, 0);
  if (u[0] * 10_000 >= total) return null;
  let x = u[1] * total;
  for (const e of market) {
    if (x < e.chanceBps) return e;
    x -= e.chanceBps;
  }
  return market.at(-1) ?? null;
}

/** Shock of an event as a log return, from a uniform draw. Algorithmic stablecoins lose their peg harder. */
export function eventShock(event: CoinEventConfig, u: number, algorithmic = false): number {
  const shock = event.shockMin + (event.shockMax - event.shockMin) * Math.min(1, Math.max(0, u));
  return event.key === "depeg" && algorithmic ? shock * 2 : shock;
}

/** Whether a coin's price counts as dead (AI meme coins are then replaced). */
export function isDead(priceE4: bigint, cfg: BalanceConfig = BALANCE): boolean {
  return priceE4 <= BigInt(cfg.crypto.deadPriceE4);
}

/** Name and ticker of a new meme coin: the first unused name, the ticker from its consonants. */
export function nextMemeCoin(
  used: ReadonlySet<string>,
  usedTickers: ReadonlySet<string>,
  cfg: BalanceConfig = BALANCE,
) {
  for (const name of cfg.crypto.memeNames) {
    if (used.has(name)) continue;
    const letters = name.toUpperCase().replace(/[^A-Z]/g, "");
    const consonants = letters.replace(/[AEIOU]/g, "");
    for (const ticker of [consonants.slice(0, 3), letters.slice(0, 3), letters.slice(0, 4), consonants.slice(0, 4)]) {
      if (ticker.length >= 3 && !usedTickers.has(ticker)) return { name, ticker };
    }
  }
  return null;
}
