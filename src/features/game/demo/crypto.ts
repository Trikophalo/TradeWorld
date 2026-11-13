import { BALANCE } from "@/config/balance";
import type { CoinCategory, CoinEventConfig } from "@/config/crypto";
import {
  actionSuccessBps,
  applyFlow,
  applyStats,
  buySlippageBps,
  coinAction,
  decayStats,
  discontinuePayoutCents,
  eventShock,
  isDead,
  isRugPull,
  launchPool,
  nextMemeCoin,
  pickRegime,
  playerCoinDriftDay,
  playerCoinSigmaDay,
  poolAt,
  poolPriceE4,
  regimeHours,
  rollCoinEvent,
  rollMarketEvent,
  stableReturn,
  swapBuy,
  swapSell,
  tickReturn,
  type Pool,
} from "@/lib/sim/crypto";
import { hasForbiddenSymbol, isValidLogo, type CompanyLogoData } from "@/lib/sim/logo";
import {
  GameError,
  type Candle,
  type CandleInterval,
  type CoinActionKey,
  type CoinDetail,
  type CoinRow,
  type CoinStats,
  type CoinStatus,
  type CryptoEvent,
  type CryptoRegime,
  type GameEngine,
  type GameErrorKey,
  type MyCoin,
  type Position,
} from "../types";

/*
 * Demo crypto market (ADR-101): the same pool maths as the server (src/lib/sim/crypto.ts), simulated lazily from the
 * time that passed since the last look. Coins, pools, the price history and the player's own coin live in the demo
 * player's local storage, so prices keep moving while the player is away.
 */

const HOUR = 3_600_000;
const BUCKET = 300_000;
const HISTORY_MS = 24 * HOUR + BUCKET;
const MAX_STEPS = 600;
const MAX_EVENT_HOURS = 48;
const EVENTS_KEPT = 40;
const cfg = BALANCE.crypto;

interface DemoCoin {
  ticker: string;
  name: string;
  category: CoinCategory;
  color: string;
  algorithmic: boolean;
  pegE4: number | null;
  cash: number;
  tokens: number;
  supplyE6: number;
  status: "listed" | "dead";
  deadAt: number | null;
  /** 5-minute buckets: [start ms, close E4, volume cents]. */
  history: [number, number, number][];
}

interface DemoOwnCoin {
  id: string;
  name: string;
  ticker: string;
  logo: CompanyLogoData;
  color: string;
  status: CoinStatus;
  stats: CoinStats;
  action: { key: CoinActionKey; startedAt: number; endsAt: number } | null;
  teamTokensE6: number;
  teamAtLaunchE6: number;
  teamSales: { at: number; quantityE6: number }[];
  rugAt: number | null;
  lastBurnAt?: number | null;
  launch: { startPriceE4: number; liquidityCents: number; teamShareBps: number; at: number } | null;
  createdAt: number;
}

export interface DemoCryptoState {
  coins: DemoCoin[];
  regime: { kind: CryptoRegime; until: number };
  lastTickAt: number;
  lastHour: number;
  events: CryptoEvent[];
  positions: Record<string, { quantityE6: number; costCents: number }>;
  mine: DemoOwnCoin | null;
  seq: number;
}

/** What the crypto part needs from the rest of the demo engine. */
export interface CryptoHost {
  state(): DemoCryptoState | undefined;
  setState(state: DemoCryptoState): void;
  level(): number;
  nickname(): string;
  tag(): string;
  trust(): { score: number; band: "risky" | "shaky" | "blank" | "reliable" | "rock" };
  cashCents(): number;
  pay(cents: number): void;
  /** Private income after a forced loan's withholding. */
  income(cents: number): void;
  /** Books a realised gain or loss like a stock sale; returns the tax. */
  realize(realizedCents: number): number;
  /** XP for a trade like stocks (daily cap); returns the XP. */
  tradeXp(grossCents: number): number;
  itScore(): number;
  feeDiscountBps(): number;
  profane(name: string): boolean;
  takenTickers(): string[];
  rugPull(): void;
  feed(kind: string, payload: Record<string, unknown>): void;
  idempotent<T>(requestId: string, run: () => T): T;
  persist(): void;
}

const burnAction = cfg.create.actions.find((a) => a.key === "marketing_burn") ?? { hype: 8, hours: 1 };

const MEME_COLORS = ["#e0a92e", "#ef5b5b", "#2bc3d9", "#9b7bff", "#2fd98c", "#f8bbd0", "#ff9a52"];

function gauss(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const big = (x: number) => BigInt(Math.round(x));
const poolOf = (c: DemoCoin): Pool => ({ cashCents: big(c.cash), tokensE6: big(c.tokens) });
const priceOf = (c: DemoCoin) => Number(poolPriceE4(poolOf(c)));
const valueCents = (quantityE6: number, priceE4: number) => Math.round((quantityE6 * priceE4) / 100_000_000);
const normalName = (name: string) => name.toLowerCase().replace(/[^a-z0-9äöüß]/g, "");

function seedCoin(seed: (typeof cfg.coins)[number]): DemoCoin {
  const pool = poolAt(big(seed.poolCents), big(seed.priceE4));
  const tokens = Number(pool.tokensE6);
  return {
    ticker: seed.ticker,
    name: seed.name,
    category: seed.category,
    color: seed.color,
    algorithmic: Boolean(seed.algorithmic),
    pegE4: seed.category === "stable" ? seed.priceE4 : null,
    cash: Number(pool.cashCents),
    tokens,
    // The pool holds a fifth of the coins; the rest is with the market.
    supplyE6: tokens * 5,
    status: "listed",
    deadAt: null,
    history: [],
  };
}

export function createCryptoEngine(host: CryptoHost) {
  function st(): DemoCryptoState {
    let s = host.state();
    if (!s) {
      const now = Date.now();
      s = {
        coins: cfg.coins.map(seedCoin),
        regime: { kind: pickRegime(Math.random()), until: now + regimeHours(Math.random()) * HOUR },
        // A day of history so the first look already shows charts and events.
        lastTickAt: now - 24 * HOUR,
        lastHour: Math.floor((now - 24 * HOUR) / HOUR),
        events: [],
        positions: {},
        mine: null,
        seq: 0,
      };
      host.setState(s);
    }
    return s;
  }

  const coinBy = (ticker: string) => st().coins.find((c) => c.ticker === ticker.toUpperCase());

  function record(c: DemoCoin, at: number, volumeCents: number) {
    const bucket = Math.floor(at / BUCKET) * BUCKET;
    const last = c.history.at(-1);
    const price = priceOf(c);
    if (last && last[0] === bucket) {
      last[1] = price;
      last[2] += volumeCents;
    } else {
      c.history.push([bucket, price, volumeCents]);
      while (c.history.length > 0 && c.history[0]![0] < at - HISTORY_MS) c.history.shift();
    }
  }

  function move(c: DemoCoin, r: number, at: number) {
    if (!Number.isFinite(r) || r === 0) return;
    const before = c.cash;
    const pool = applyFlow(poolOf(c), r);
    c.cash = Math.max(1, Number(pool.cashCents));
    c.tokens = Math.max(1, Number(pool.tokensE6));
    record(c, at, Math.abs(c.cash - before));
  }

  function log(
    c: { ticker: string; name: string },
    key: string,
    shock: number,
    at: number,
    payload: Record<string, unknown> = {},
  ) {
    const s = st();
    s.events.unshift({
      ticker: c.ticker,
      name: c.name,
      key,
      shockBps: Math.round((Math.exp(shock) - 1) * 10_000),
      at: new Date(at).toISOString(),
      payload,
    });
    s.events = s.events.slice(0, EVENTS_KEPT);
  }

  function mineStats(): CoinStats | null {
    const mine = st().mine;
    return mine ? mine.stats : null;
  }

  function hitEvent(c: DemoCoin, e: CoinEventConfig, at: number) {
    const shock = eventShock(e, Math.random(), c.algorithmic);
    move(c, shock, at);
    if (e.poolLossShare) {
      c.cash = Math.max(1, Math.round(c.cash * (1 - e.poolLossShare)));
      record(c, at, 0);
    }
    const mine = st().mine;
    if (c.category === "player" && mine && mine.ticker === c.ticker)
      mine.stats = applyStats(mine.stats, { tech: e.tech, hype: e.hype, utility: e.utility });
    log(c, e.key, shock, at);
  }

  function hourly(at: number) {
    const s = st();
    const mine = s.mine;
    if (mine && mine.status === "listed") mine.stats = decayStats(mine.stats, 1);
    for (const c of s.coins) {
      if (c.status !== "listed") continue;
      const stats = c.category === "player" ? mineStats() : null;
      const e = rollCoinEvent([Math.random(), Math.random()], c.category, stats);
      if (e) hitEvent(c, e, at);
    }
    const market = rollMarketEvent([Math.random(), Math.random()]);
    if (market) {
      const shock = eventShock(market, Math.random());
      for (const c of s.coins) {
        if (c.status !== "listed" || c.category === "stable") continue;
        if (market.key === "meme_wave" && c.category !== "meme") continue;
        move(c, shock, at);
      }
      log({ ticker: "*", name: "" }, market.key, shock, at);
    }
    // Dead AI meme coins are replaced after a while; holders keep nothing.
    for (const c of [...s.coins]) {
      if (c.category === "player" || c.category === "stable") continue;
      if (c.status === "listed" && isDead(BigInt(priceOf(c)))) {
        c.status = "dead";
        c.deadAt = at;
        log(c, "dead", 0, at);
      }
      if (c.status === "dead" && c.deadAt !== null && at - c.deadAt >= cfg.deadCoinReplaceHours * HOUR)
        replaceDead(c, at);
    }
  }

  function replaceDead(c: DemoCoin, at: number) {
    const s = st();
    const position = s.positions[c.ticker];
    if (position) {
      host.realize(-position.costCents);
      delete s.positions[c.ticker];
    }
    s.coins = s.coins.filter((x) => x !== c);
    const used = new Set(s.coins.map((x) => x.name));
    const usedTickers = new Set([...s.coins.map((x) => x.ticker), ...host.takenTickers()]);
    const next = nextMemeCoin(used, usedTickers);
    if (!next) return;
    s.seq += 1;
    const fresh = seedCoin({
      ticker: next.ticker,
      name: next.name,
      category: "meme",
      priceE4: 500,
      poolCents: 15_000_000,
      color: MEME_COLORS[s.seq % MEME_COLORS.length]!,
    });
    record(fresh, at, 0);
    s.coins.push(fresh);
    log(fresh, "listed", 0, at, { replaces: c.ticker });
  }

  function resolveAction(at: number) {
    const mine = st().mine;
    if (!mine?.action || at < mine.action.endsAt) return;
    const action = coinAction(mine.action.key)!;
    const ok = Math.random() * 10_000 < actionSuccessBps(action, host.itScore());
    mine.action = null;
    const coin = coinBy(mine.ticker);
    if (ok) mine.stats = applyStats(mine.stats, { tech: action.tech, hype: action.hype, utility: action.utility });
    else if (action.key === "influencer") {
      // Exposed as paid advertising.
      mine.stats = applyStats(mine.stats, { hype: cfg.create.exposedHype });
      if (coin) move(coin, cfg.create.exposedShock, at);
      log(mine, "exposed", cfg.create.exposedShock, at);
    }
    log(mine, "action", 0, at, { action: action.key, success: ok });
  }

  function advance(now = Date.now()) {
    const s = st();
    const elapsedMs = now - s.lastTickAt;
    const tickMs = cfg.tickSeconds * 1000;
    if (elapsedMs < tickMs) {
      resolveAction(now);
      return;
    }
    const steps = Math.min(MAX_STEPS, Math.floor(elapsedMs / tickMs));
    const stepMs = elapsedMs / steps;
    const firstEventHour = Math.max(s.lastHour, Math.floor(now / HOUR) - MAX_EVENT_HOURS);
    s.lastHour = Math.max(s.lastHour, firstEventHour);
    for (let i = 1; i <= steps; i++) {
      const at = Math.round(s.lastTickAt + i * stepMs);
      if (at >= s.regime.until)
        s.regime = { kind: pickRegime(Math.random()), until: at + regimeHours(Math.random()) * HOUR };
      while (Math.floor(at / HOUR) > s.lastHour) {
        s.lastHour += 1;
        hourly(s.lastHour * HOUR);
      }
      resolveAction(at);
      const drift = cfg.regimes[s.regime.kind].driftDay;
      const zMarket = gauss();
      const seconds = stepMs / 1000;
      for (const c of s.coins) {
        if (c.status !== "listed") continue;
        const cat = cfg.categories[c.category];
        let r: number;
        if (c.category === "stable" && c.pegE4)
          r = stableReturn(priceOf(c), c.pegE4, cat.pegPullPerHour, cat.sigmaDay, gauss(), seconds);
        else if (c.category === "player") {
          const stats = decayStats(mineStats() ?? { tech: 0, hype: 0, utility: 0 }, 0);
          r = tickReturn(
            { sigmaDay: playerCoinSigmaDay(stats.tech), beta: cat.beta, extraDriftDay: playerCoinDriftDay(stats) },
            drift,
            zMarket,
            gauss(),
            seconds,
          );
        } else r = tickReturn({ sigmaDay: cat.sigmaDay, beta: cat.beta }, drift, zMarket, gauss(), seconds);
        move(c, r, at);
      }
    }
    s.lastTickAt = now;
    const mine = s.mine;
    const own = mine ? coinBy(mine.ticker) : null;
    if (mine && own && own.status === "listed" && isDead(BigInt(priceOf(own)))) {
      own.status = "dead";
      own.deadAt = now;
      mine.status = "dead";
    }
  }

  // ------------------------------------------------------------------ views

  function stats24h(c: DemoCoin) {
    const price = priceOf(c);
    const since = Date.now() - 24 * HOUR;
    const recent = c.history.filter((h) => h[0] >= since);
    const first = recent[0]?.[1] ?? price;
    const prices = [...recent.map((h) => h[1]), price];
    return {
      price,
      changeBps: first > 0 ? Math.round(((price - first) / first) * 10_000) : 0,
      high: Math.max(...prices),
      low: Math.min(...prices),
      volume: recent.reduce((sum, h) => sum + h[2], 0),
    };
  }

  function feeBps(c: DemoCoin) {
    const base = cfg.categories[c.category].feeBps;
    return Math.round((base * (10_000 - host.feeDiscountBps())) / 10_000);
  }

  function row(c: DemoCoin): CoinRow {
    const s = st();
    const d = stats24h(c);
    const mine = s.mine && s.mine.ticker === c.ticker ? s.mine : null;
    return {
      ticker: c.ticker,
      name: c.name,
      category: c.category,
      status: c.status,
      priceE4: d.price,
      change24hBps: d.changeBps,
      high24hE4: d.high,
      low24hE4: d.low,
      poolCents: Math.round(c.cash),
      marketCapCents: valueCents(c.supplyE6, d.price),
      volume24hCents: d.volume,
      feeBps: feeBps(c),
      color: c.color,
      logo: mine?.logo ?? null,
      creator: mine
        ? { nickname: host.nickname(), tag: host.tag(), trust: { score: host.trust().score, band: host.trust().band } }
        : null,
      stats: mine ? roundStats(mine.stats) : null,
      myQuantityE6: s.positions[c.ticker]?.quantityE6 ?? 0,
    };
  }

  const roundStats = (x: CoinStats): CoinStats => ({
    tech: Math.round(x.tech),
    hype: Math.round(x.hype),
    utility: Math.round(x.utility),
  });

  function myCoinView(mine: DemoOwnCoin): MyCoin {
    const coin = coinBy(mine.ticker);
    const now = Date.now();
    const base: CoinRow = coin
      ? row(coin)
      : {
          ticker: mine.ticker,
          name: mine.name,
          category: "player",
          status: mine.status,
          priceE4: 0,
          change24hBps: 0,
          high24hE4: 0,
          low24hE4: 0,
          poolCents: 0,
          marketCapCents: 0,
          volume24hCents: 0,
          feeBps: cfg.categories.player.feeBps,
          color: mine.color,
          logo: mine.logo,
          creator: { nickname: host.nickname(), tag: host.tag(), trust: host.trust() },
          stats: roundStats(mine.stats),
          myQuantityE6: 0,
        };
    const listed = mine.status === "listed";
    return {
      ...base,
      status: mine.status,
      logo: mine.logo,
      id: mine.id,
      stats: roundStats(mine.stats),
      action: mine.action
        ? {
            key: mine.action.key,
            startedAt: new Date(mine.action.startedAt).toISOString(),
            endsAt: new Date(mine.action.endsAt).toISOString(),
          }
        : null,
      actions: cfg.create.actions.map((a) => ({
        key: a.key,
        costCents: a.costCents,
        hours: a.hours,
        successBps: actionSuccessBps(a, host.itScore()),
        available:
          !mine.action &&
          (a.afterLaunch ? listed : mine.status === "draft" || listed) &&
          host.cashCents() >= a.costCents,
      })),
      teamTokensE6: mine.teamTokensE6,
      teamAtLaunchE6: mine.teamAtLaunchE6,
      teamSoldWindowE6: mine.teamSales
        .filter((x) => x.at >= now - cfg.create.rugWindowHours * HOUR)
        .reduce((sum, x) => sum + x.quantityE6, 0),
      rugLimitE6: Math.floor((mine.teamAtLaunchE6 * cfg.create.rugShareBps) / 10_000),
      launch: mine.launch
        ? {
            startPriceE4: mine.launch.startPriceE4,
            liquidityCents: mine.launch.liquidityCents,
            teamShareBps: mine.launch.teamShareBps,
            at: new Date(mine.launch.at).toISOString(),
          }
        : null,
      createdAt: new Date(mine.createdAt).toISOString(),
      burnHype: burnAction.hype ?? 0,
      burnMinE6: burnMin(mine),
      burnAvailableAt:
        mine.lastBurnAt && mine.lastBurnAt + burnAction.hours * HOUR > now
          ? new Date(mine.lastBurnAt + burnAction.hours * HOUR).toISOString()
          : null,
    };
  }

  function burnMin(mine: DemoOwnCoin) {
    return Math.min(mine.teamTokensE6, Math.max(1, Math.round((mine.teamAtLaunchE6 * cfg.create.burnMinBps) / 10_000)));
  }

  function requireCrypto() {
    if (host.level() < cfg.minLevel) throw new GameError("locked");
  }

  function myOpenCoin(): DemoOwnCoin {
    const mine = st().mine;
    if (!mine || mine.status === "closed") throw new GameError("coin_not_found");
    return mine;
  }

  function nameProblem(name: string, ticker: string): GameErrorKey | null {
    const c = cfg.create;
    const n = name.trim();
    if (n.length < c.nameMinLength) return "name_too_short";
    if (n.length > c.nameMaxLength) return "name_too_long";
    if (!/^[\p{L}0-9][\p{L}0-9 -]*$/u.test(n)) return "name_invalid_chars";
    if (host.profane(n)) return "name_profanity";
    const s = st();
    const names = [...s.coins.map((x) => x.name), ...(s.mine && s.mine.status !== "closed" ? [s.mine.name] : [])];
    if (names.some((x) => normalName(x) === normalName(n))) return "name_taken";
    const t = ticker.trim().toUpperCase();
    if (!new RegExp(`^[A-Z]{${c.tickerMinLength},${c.tickerMaxLength}}$`).test(t)) return "invalid_argument";
    const tickers = [
      ...s.coins.map((x) => x.ticker),
      ...host.takenTickers(),
      ...(s.mine && s.mine.status !== "closed" ? [s.mine.ticker] : []),
    ];
    if (tickers.includes(t)) return "ticker_taken";
    return null;
  }

  // ------------------------------------------------------------------ trading

  function trade(input: Parameters<GameEngine["cryptoTrade"]>[0]) {
    requireCrypto();
    advance();
    const s = st();
    const c = coinBy(input.ticker);
    if (!c) throw new GameError("coin_not_found");
    if (c.status !== "listed") throw new GameError("coin_not_tradable");
    const fee = feeBps(c);
    const before = priceOf(c);
    const position = s.positions[c.ticker] ?? { quantityE6: 0, costCents: 0 };

    // Like stocks: one order fee per trade, on a buy it is part of the amount.
    const orderFee = BALANCE.trading.orderFeeCents;
    const minOrder = BALANCE.trading.minOrderValueCents;
    if (input.side === "buy") {
      const amount = Math.floor(input.amountCents ?? 0);
      if (amount <= 0) throw new GameError("invalid_quantity");
      const swap = amount - orderFee;
      if (swap < minOrder) throw new GameError("order_too_small");
      if (amount > host.cashCents()) throw new GameError("insufficient_funds");
      const pool = poolOf(c);
      if (buySlippageBps(pool, big(swap), fee) > input.maxSlippageBps) throw new GameError("slippage_exceeded");
      const r = swapBuy(pool, big(swap), fee);
      const quantity = Number(r.tokensOutE6);
      if (quantity <= 0) throw new GameError("order_too_small");
      host.pay(amount);
      c.cash = Number(r.pool.cashCents);
      c.tokens = Number(r.pool.tokensE6);
      position.quantityE6 += quantity;
      position.costCents += swap;
      s.positions[c.ticker] = position;
      record(c, Date.now(), swap);
      const xp = host.tradeXp(swap);
      return result("buy", c, quantity, amount, Number(r.feeCents) + orderFee, Math.round((swap * 1e8) / quantity), {
        tax: 0,
        xp,
        rug: false,
      });
    }

    const quantity = Math.floor(input.quantityE6 ?? 0);
    if (quantity <= 0) throw new GameError("invalid_quantity");
    if (quantity > position.quantityE6) throw new GameError("insufficient_position");
    const r = swapSell(poolOf(c), big(quantity), fee);
    const cash = Number(r.cashOutCents);
    if (cash < minOrder && quantity !== position.quantityE6) throw new GameError("order_too_small");
    const avg = Math.round((cash * 100_000_000) / quantity);
    const slippage = before > 0 ? Math.round(((before - avg) / before) * 10_000) : 10_000;
    if (slippage > input.maxSlippageBps) throw new GameError("slippage_exceeded");
    c.cash = Number(r.pool.cashCents);
    c.tokens = Number(r.pool.tokensE6);
    const cost = Math.round((position.costCents * quantity) / position.quantityE6);
    position.quantityE6 -= quantity;
    position.costCents -= cost;
    if (position.quantityE6 > 0) s.positions[c.ticker] = position;
    else delete s.positions[c.ticker];
    const tax = host.realize(cash - orderFee - cost);
    const net = cash - orderFee - tax;
    host.income(net);
    record(c, Date.now(), cash);
    const xp = host.tradeXp(cash);
    const rug = teamSale(c, quantity);
    return result("sell", c, quantity, net, Number(r.feeCents) + orderFee, avg, { tax, xp, rug });
  }

  /** The creator sells team coins: counts toward the rug pull window (ADR-101). */
  function teamSale(c: DemoCoin, quantity: number): boolean {
    const mine = st().mine;
    if (!mine || mine.ticker !== c.ticker || mine.teamTokensE6 <= 0) return false;
    const now = Date.now();
    const sold = Math.min(quantity, mine.teamTokensE6);
    mine.teamTokensE6 -= sold;
    mine.teamSales = [
      ...mine.teamSales.filter((x) => x.at >= now - cfg.create.rugWindowHours * HOUR),
      { at: now, quantityE6: sold },
    ];
    const window = mine.teamSales.reduce((sum, x) => sum + x.quantityE6, 0);
    const already = mine.rugAt !== null && mine.rugAt >= now - cfg.create.rugWindowHours * HOUR;
    if (!already && isRugPull(BigInt(window), BigInt(mine.teamAtLaunchE6))) {
      mine.rugAt = now;
      mine.stats = { ...mine.stats, hype: 0 };
      host.rugPull();
      host.feed("rug_pull", { ticker: c.ticker, name: c.name });
      log(c, "rug_pull", 0, now, { by_creator: true, sold_e6: window });
      return true;
    }
    return false;
  }

  function result(
    side: "buy" | "sell",
    c: DemoCoin,
    quantityE6: number,
    cashCents: number,
    feeCents: number,
    avgPriceE4: number,
    extra: { tax: number; xp: number; rug: boolean },
  ) {
    return {
      side,
      ticker: c.ticker,
      quantityE6,
      cashCents,
      feeCents,
      priceE4: priceOf(c),
      avgPriceE4,
      positionE6: st().positions[c.ticker]?.quantityE6 ?? 0,
      cashAfterCents: host.cashCents(),
      taxCents: extra.tax,
      xpAwarded: extra.xp,
      rugPull: extra.rug,
    };
  }

  // ------------------------------------------------------------------ candles

  function candles(ticker: string, interval: CandleInterval, limit: number): Candle[] {
    advance();
    const c = coinBy(ticker);
    if (!c) return [];
    const size = { "1m": BUCKET, "5m": BUCKET, "1h": HOUR, "1q": 6 * HOUR, "1y": 24 * HOUR }[interval];
    const bars = new Map<number, Candle>();
    let prev = c.history[0]?.[1] ?? priceOf(c);
    for (const [at, close, volume] of c.history) {
      const time = Math.floor(at / size) * size;
      const bar = bars.get(time);
      if (bar) {
        bar.high = Math.max(bar.high, close);
        bar.low = Math.min(bar.low, close);
        bar.close = close;
        bar.volume += volume;
      } else
        bars.set(time, {
          time: time / 1000,
          open: prev,
          high: Math.max(prev, close),
          low: Math.min(prev, close),
          close,
          volume,
        });
      prev = close;
    }
    return [...bars.values()].slice(-limit);
  }

  // ------------------------------------------------------------------ engine

  const engine: Pick<
    GameEngine,
    | "cryptoMarket"
    | "coin"
    | "cryptoTrade"
    | "myCoin"
    | "checkCoinName"
    | "createCoin"
    | "startCoinAction"
    | "launchCoin"
    | "burnCoinTokens"
    | "discontinueCoin"
  > = {
    async cryptoMarket() {
      requireCrypto();
      advance();
      const s = st();
      host.persist();
      return {
        regime: { kind: s.regime.kind, until: new Date(s.regime.until).toISOString() },
        coins: s.coins.map(row),
        events: s.events.slice(0, 20),
      };
    },

    async coin(ticker): Promise<CoinDetail> {
      requireCrypto();
      advance();
      const s = st();
      const c = coinBy(ticker);
      if (!c) throw new GameError("coin_not_found");
      const r = row(c);
      const position = s.positions[c.ticker];
      const mine = s.mine && s.mine.ticker === c.ticker ? s.mine : null;
      return {
        ...r,
        pool: { cashCents: Math.round(c.cash), tokensE6: Math.round(c.tokens) },
        supplyE6: c.supplyE6,
        teamTokensE6: mine ? mine.teamTokensE6 : null,
        holders:
          c.category === "player"
            ? 1 + Math.round((mine?.stats.hype ?? 0) / 4)
            : Math.max(12, Math.round(c.cash / 200_000)),
        myPosition: position
          ? {
              quantityE6: position.quantityE6,
              avgPriceE4: Math.round((position.costCents * 100_000_000) / Math.max(1, position.quantityE6)),
              valueCents: valueCents(position.quantityE6, r.priceE4),
            }
          : null,
        events: s.events.filter((e) => e.ticker === c.ticker).slice(0, 20),
      };
    },

    cryptoTrade: async (input) => host.idempotent(input.requestId, () => trade(input)),

    async myCoin() {
      advance();
      const mine = st().mine;
      return mine && mine.status !== "closed" ? myCoinView(mine) : null;
    },

    async checkCoinName(name, ticker) {
      const reason = nameProblem(name, ticker);
      return { allowed: reason === null, reason };
    },

    createCoin: async (requestId, name, ticker, logo) =>
      host.idempotent(requestId, () => {
        if (host.level() < cfg.createMinLevel) throw new GameError("locked");
        const s = st();
        if (s.mine && s.mine.status !== "closed") throw new GameError("coin_exists");
        const problem = nameProblem(name, ticker);
        if (problem) throw new GameError(problem);
        if (!isValidLogo(logo)) throw new GameError("invalid_argument");
        if (hasForbiddenSymbol(logo)) throw new GameError("logo_forbidden");
        if (host.cashCents() < cfg.create.costCents) throw new GameError("insufficient_funds");
        host.pay(cfg.create.costCents);
        s.seq += 1;
        s.mine = {
          id: `coin-${s.seq}`,
          name: name.trim(),
          ticker: ticker.trim().toUpperCase(),
          logo,
          color: logo.palette[1] ?? logo.palette[0] ?? "#7c5cff",
          status: "draft",
          stats: { tech: 0, hype: 0, utility: 0 },
          action: null,
          teamTokensE6: 0,
          teamAtLaunchE6: 0,
          teamSales: [],
          rugAt: null,
          launch: null,
          createdAt: Date.now(),
        };
        log(s.mine, "created", 0, Date.now());
        return myCoinView(s.mine);
      }),

    startCoinAction: async (requestId, key) =>
      host.idempotent(requestId, () => {
        advance();
        const mine = myOpenCoin();
        const action = coinAction(key);
        if (!action) throw new GameError("invalid_argument");
        if (mine.action) throw new GameError("coin_action_running");
        if (action.afterLaunch && mine.status !== "listed") throw new GameError("coin_not_launched");
        if (mine.status === "dead") throw new GameError("coin_not_tradable");
        if (host.cashCents() < action.costCents) throw new GameError("insufficient_funds");
        host.pay(action.costCents);
        const now = Date.now();
        mine.action = { key: action.key, startedAt: now, endsAt: now + action.hours * HOUR };
        return myCoinView(mine);
      }),

    launchCoin: async (requestId, startPriceE4, liquidityCents, teamShareBps) =>
      host.idempotent(requestId, () => {
        const c = cfg.create;
        const mine = myOpenCoin();
        if (mine.status !== "draft") throw new GameError("already_listed");
        if (mine.stats.tech < c.launchMinTech) throw new GameError("coin_tech_too_low");
        if (!c.startPriceOptionsE4.includes(startPriceE4)) throw new GameError("invalid_argument");
        if (teamShareBps < c.teamShareMinBps || teamShareBps > c.teamShareMaxBps)
          throw new GameError("invalid_argument");
        if (liquidityCents < c.minLiquidityCents) throw new GameError("invalid_argument");
        if (liquidityCents > host.cashCents()) throw new GameError("insufficient_funds");
        host.pay(liquidityCents);
        const launched = launchPool(big(liquidityCents), big(startPriceE4), teamShareBps);
        const now = Date.now();
        const s = st();
        const coin: DemoCoin = {
          ticker: mine.ticker,
          name: mine.name,
          category: "player",
          color: mine.color,
          algorithmic: false,
          pegE4: null,
          cash: Number(launched.pool.cashCents),
          tokens: Number(launched.pool.tokensE6),
          supplyE6: Number(launched.supplyE6),
          status: "listed",
          deadAt: null,
          history: [],
        };
        record(coin, now, 0);
        s.coins.push(coin);
        const team = Number(launched.teamTokensE6);
        s.positions[coin.ticker] = { quantityE6: team, costCents: 0 };
        mine.teamTokensE6 = team;
        mine.teamAtLaunchE6 = team;
        mine.status = "listed";
        mine.launch = { startPriceE4, liquidityCents, teamShareBps, at: now };
        host.feed("coin_launched", { ticker: coin.ticker, name: coin.name });
        log(coin, "launch", 0, now, {
          start_price_e4: startPriceE4,
          liquidity_cents: liquidityCents,
          team_share_bps: teamShareBps,
        });
        return myCoinView(mine);
      }),

    burnCoinTokens: async (requestId, quantityE6) =>
      host.idempotent(requestId, () => {
        const mine = myOpenCoin();
        if (mine.status !== "listed") throw new GameError("coin_not_launched");
        const quantity = Math.floor(quantityE6);
        if (quantity <= 0) throw new GameError("invalid_quantity");
        if (quantity > mine.teamTokensE6) throw new GameError("insufficient_position");
        if (quantity < burnMin(mine)) throw new GameError("invalid_quantity");
        const now = Date.now();
        if (mine.lastBurnAt && mine.lastBurnAt + burnAction.hours * HOUR > now) throw new GameError("rate_limited");
        const s = st();
        const coin = coinBy(mine.ticker)!;
        const position = s.positions[coin.ticker];
        if (!position || position.quantityE6 < quantity) throw new GameError("insufficient_position");
        position.costCents -= Math.round((position.costCents * quantity) / position.quantityE6);
        position.quantityE6 -= quantity;
        if (position.quantityE6 <= 0) delete s.positions[coin.ticker];
        mine.teamTokensE6 -= quantity;
        coin.supplyE6 -= quantity;
        mine.stats = applyStats(mine.stats, { hype: burnAction.hype ?? 0 });
        mine.lastBurnAt = now;
        log(coin, "burn", 0, now, { quantity_e6: quantity });
        return myCoinView(mine);
      }),

    discontinueCoin: async (requestId) =>
      host.idempotent(requestId, () => {
        advance();
        const mine = myOpenCoin();
        const s = st();
        const coin = coinBy(mine.ticker);
        let view = myCoinView(mine);
        if (coin) {
          const position = s.positions[coin.ticker];
          const circulating = Math.max(0, coin.supplyE6 - coin.tokens);
          if (position) {
            const payout = Number(
              discontinuePayoutCents(big(coin.cash), big(position.quantityE6), big(Math.max(circulating, 1))),
            );
            const tax = host.realize(payout - position.costCents);
            host.income(payout - tax);
            delete s.positions[coin.ticker];
          }
          s.coins = s.coins.filter((x) => x !== coin);
          host.feed("coin_closed", { ticker: coin.ticker, name: coin.name });
          log(coin, "closed", 0, Date.now());
        }
        mine.status = "closed";
        mine.action = null;
        view = { ...view, status: "closed" };
        s.mine = null;
        return view;
      }),
  };

  return {
    engine,
    candles,
    isCoin: (ticker: string) => Boolean(coinBy(ticker)),
    /** Crypto positions for the portfolio (kind "crypto"). */
    positions(): Position[] {
      if (!host.state()) return [];
      advance();
      const s = st();
      return Object.entries(s.positions).flatMap(([ticker, pos]) => {
        const c = coinBy(ticker);
        if (!c) return [];
        const price = c.status === "listed" ? priceOf(c) : 0;
        const value = valueCents(pos.quantityE6, price);
        return [
          {
            ticker,
            name: c.name,
            kind: "crypto" as const,
            quantityE6: pos.quantityE6,
            reservedQuantityE6: 0,
            avgPriceE4: Math.round((pos.costCents * 100_000_000) / Math.max(1, pos.quantityE6)),
            lastPriceE4: price,
            marketValueCents: value,
            costBasisCents: pos.costCents,
            unrealizedPnlCents: value - pos.costCents,
          },
        ];
      });
    },
  };
}
