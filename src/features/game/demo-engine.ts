import { BALANCE } from "@/config/balance";
import { DEMO_COMPANIES, DEMO_INDEX } from "@/lib/demo/market";
import { bondPriceE4, bondYieldBps } from "@/lib/sim/bonds";
import { levelFromTotalXp, levelProgress, scaledXp, unlockLevel } from "@/lib/sim/progression";
import {
  GameError,
  type Candle,
  type CandleInterval,
  type GameEngine,
  type MarketSnapshot,
  type OpenOrder,
  type OrderInput,
  type OrderResult,
  type Portfolio,
  type Security,
  type Session,
  type Trade,
} from "./types";

/*
 * Offline engine for demo mode (no Supabase settings, docs/DECISIONS.md ADR-015).
 * It follows the same rules as the server in simple form, so the whole game can
 * be tried without an account: spread, price impact, fee, tax with loss pot,
 * resting limit orders, vault, XP. State lives in memory and is gone on reload.
 */

const { trading, economy, time, progression } = BALANCE;
const HOUR = 3_600_000;
const PRICE_SCALE = 10_000;

interface Holding {
  quantity: number;
  reserved: number;
  /** FIFO lots: quantity and price in e4 */
  lots: { quantity: number; priceE4: number }[];
}

interface DemoState {
  mids: Map<string, number>;
  prevClose: Map<string, number>;
  dayHigh: Map<string, number>;
  dayLow: Map<string, number>;
  volume: Map<string, number>;
  /** Player-caused pressure in bps, decays every tick */
  flow: Map<string, number>;
  indexValueE4: number;
  tickSeq: number;
  cashCents: number;
  reservedCents: number;
  lossPotCents: number;
  holdings: Map<string, Holding>;
  orders: (OpenOrder & { reservedCents: number })[];
  trades: Trade[];
  vaultClaimedAt: number;
  xpTotal: number;
  tradesToday: number;
  tutorialCompleted: boolean;
  requests: Map<string, unknown>;
}

const BONDS = [1, 2, 5, 10].map((years) => ({
  ticker: `NXB${String(years).padStart(2, "0")}`,
  name: years === 1 ? "Staatsanleihe 1 Jahr" : `Staatsanleihe ${years} Jahre`,
  years,
  couponBps: bondYieldBps(BALANCE.centralBank.startRateBps, years),
}));

function bondMid(couponBps: number, years: number): number {
  const remaining = years * BALANCE.bonds.couponsPerGameYear;
  return Number(bondPriceE4(couponBps, bondYieldBps(BALANCE.centralBank.startRateBps, years), remaining));
}

function initialState(): DemoState {
  const mids = new Map<string, number>();
  const prevClose = new Map<string, number>();
  for (const c of DEMO_COMPANIES) {
    mids.set(c.ticker, c.priceE4);
    prevClose.set(c.ticker, Math.round(c.priceE4 / (1 + c.changeBps / 10_000)));
  }
  for (const b of BONDS) {
    const mid = bondMid(b.couponBps, b.years);
    mids.set(b.ticker, mid);
    prevClose.set(b.ticker, mid);
  }
  return {
    mids,
    prevClose,
    dayHigh: new Map(mids),
    dayLow: new Map(mids),
    volume: new Map(),
    flow: new Map(),
    indexValueE4: Math.round(DEMO_INDEX.points * PRICE_SCALE),
    tickSeq: 0,
    cashCents: economy.startingCapitalCents,
    reservedCents: 0,
    lossPotCents: 0,
    holdings: new Map(),
    orders: [],
    trades: [],
    vaultClaimedAt: Date.now() - (economy.vaultInitialHours ?? 2) * HOUR,
    xpTotal: 0,
    tradesToday: 0,
    tutorialCompleted: false,
    requests: new Map(),
  };
}

/*
 * The player's part of the demo survives a reload (localStorage); market prices
 * start fresh. Wrapped in try/catch: storage can be unavailable.
 */
const STORAGE_KEY = "nexa-demo-player";
const TUTORIAL_KEY = "nexa-tutorial";

interface SavedPlayer {
  cashCents: number;
  reservedCents: number;
  lossPotCents: number;
  holdings: [string, Holding][];
  orders: DemoState["orders"];
  trades: Trade[];
  vaultClaimedAt: number;
  xpTotal: number;
  tradesToday: number;
  tutorialCompleted: boolean;
}

function restore(st: DemoState): DemoState {
  if (typeof window === "undefined") return st;
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as SavedPlayer | null;
    if (saved) {
      Object.assign(st, { ...saved, holdings: new Map(saved.holdings) });
    } else {
      // A finished tutorial from an earlier visit still counts.
      const tutorial = JSON.parse(window.localStorage.getItem(TUTORIAL_KEY) ?? "{}") as Record<
        string,
        { status?: string }
      >;
      if (tutorial.demo?.status === "done") {
        st.tutorialCompleted = true;
        st.xpTotal = scaledXp(progression.xpSources.tutorial.xp);
      }
    }
  } catch {
    // Start fresh.
  }
  return st;
}

function persist(): void {
  if (typeof window === "undefined" || !state) return;
  const st = state;
  const saved: SavedPlayer = {
    cashCents: st.cashCents,
    reservedCents: st.reservedCents,
    lossPotCents: st.lossPotCents,
    holdings: [...st.holdings],
    orders: st.orders,
    trades: st.trades,
    vaultClaimedAt: st.vaultClaimedAt,
    xpTotal: st.xpTotal,
    tradesToday: st.tradesToday,
    tutorialCompleted: st.tutorialCompleted,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Ignore: the demo simply forgets on reload.
  }
}

let state: DemoState | null = null;
const s = (): DemoState => (state ??= restore(initialState()));

export function demoSession(now = new Date()): Session {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: time.timezone }).format(now),
  );
  return hour >= time.marketOpenHour && hour < time.marketCloseHour ? "regular" : "after_hours";
}

function meta(ticker: string) {
  const company = DEMO_COMPANIES.find((c) => c.ticker === ticker);
  if (company) return { kind: "stock" as const, company, bond: null };
  const bond = BONDS.find((b) => b.ticker === ticker);
  if (bond) return { kind: "bond" as const, company: null, bond };
  throw new GameError("unknown_security");
}

function halfSpreadBps(ticker: string): number {
  const m = meta(ticker);
  const base = m.company ? trading.spread.halfSpreadBps[m.company.tier] : 3;
  return demoSession() === "after_hours" ? base * time.afterHours.spreadMultiplier : base;
}

function quote(ticker: string) {
  const mid = s().mids.get(ticker)!;
  const half = Math.max(trading.spread.minHalfSpreadE4, Math.round((mid * halfSpreadBps(ticker)) / 10_000));
  return { mid, bid: Math.max(1, mid - half), ask: mid + half };
}

/** Shares that move the price by `impactBpsPerDepth` (one "depth"). */
function depthShares(ticker: string): number {
  const m = meta(ticker);
  if (!m.company) return 50_000;
  const shares = m.company.marketCapCents / (m.company.priceE4 / 100);
  const liquidity = demoSession() === "after_hours" ? time.afterHours.liquidityMultiplier : 1;
  return Math.max(50, shares * trading.priceImpact.depthFreeFloatFraction * liquidity);
}

function impactBps(ticker: string, quantity: number): number {
  return (trading.priceImpact.impactBpsPerDepth * quantity) / depthShares(ticker);
}

function snapshotNow(): MarketSnapshot {
  const st = s();
  const securities: Security[] = [];
  for (const c of DEMO_COMPANIES) securities.push(securityOf(c.ticker));
  for (const b of BONDS) securities.push(securityOf(b.ticker));
  const prevIndex = Math.round((DEMO_INDEX.points * PRICE_SCALE) / (1 + DEMO_INDEX.changeBps / 10_000));
  return {
    serverTime: new Date().toISOString(),
    tickSeq: st.tickSeq,
    session: demoSession(),
    paused: false,
    policyRateBps: BALANCE.centralBank.startRateBps,
    index: {
      ticker: "NEXA30",
      name: "NEXA 30",
      valueE4: st.indexValueE4,
      prevCloseE4: prevIndex,
      changeBps: Math.round((st.indexValueE4 / prevIndex - 1) * 10_000),
    },
    securities,
  };
}

function securityOf(ticker: string): Security {
  const st = s();
  const m = meta(ticker);
  const q = quote(ticker);
  const prev = st.prevClose.get(ticker)!;
  return {
    id: `demo-${ticker}`,
    ticker,
    name: m.company?.name ?? m.bond!.name,
    kind: m.kind,
    sector: m.company?.sector ?? null,
    sizeClass: m.company?.tier ?? null,
    lastE4: q.mid,
    bidE4: q.bid,
    askE4: q.ask,
    prevCloseE4: prev,
    changeBps: Math.round((q.mid / prev - 1) * 10_000),
    dayHighE4: st.dayHigh.get(ticker)!,
    dayLowE4: st.dayLow.get(ticker)!,
    dayVolume: st.volume.get(ticker) ?? 0,
    marketCapCents: m.company ? Math.round((m.company.marketCapCents * q.mid) / m.company.priceE4) : null,
    bond: m.bond
      ? {
          termGameYears: m.bond.years,
          couponBps: m.bond.couponBps,
          yieldBps: bondYieldBps(BALANCE.centralBank.startRateBps, m.bond.years),
          maturesAt: new Date(Date.now() + m.bond.years * 24 * HOUR).toISOString(),
          faceValueCents: BALANCE.bonds.faceValueCents,
        }
      : null,
  };
}

/** One market step: noise by size class, pull toward the start price, decaying player flow. */
export function demoTick(): void {
  const st = s();
  st.tickSeq += 1;
  let indexMove = 0;
  for (const c of DEMO_COMPANIES) {
    const mid = st.mids.get(c.ticker)!;
    const vol = { bluechip: 4, midcap: 9, penny: 28 }[c.tier];
    const noise = (Math.random() + Math.random() + Math.random() - 1.5) * vol;
    const anchor = Math.log(c.priceE4 / mid) * 40; // gentle reversion
    const flow = st.flow.get(c.ticker) ?? 0;
    const moveBps = noise + anchor + flow * 0.15;
    st.flow.set(c.ticker, flow * 0.85);
    const next = Math.max(10, Math.round(mid * (1 + moveBps / 10_000)));
    st.mids.set(c.ticker, next);
    st.dayHigh.set(c.ticker, Math.max(st.dayHigh.get(c.ticker)!, next));
    st.dayLow.set(c.ticker, Math.min(st.dayLow.get(c.ticker)!, next));
    indexMove += (moveBps * c.marketCapCents) / 1e14;
  }
  st.indexValueE4 = Math.round(st.indexValueE4 * (1 + indexMove / 10_000));
  if (st.orders.length > 0) {
    fillRestingOrders();
    persist();
  }
}

function fillRestingOrders(): void {
  const st = s();
  for (const order of [...st.orders]) {
    const q = quote(order.ticker);
    const limit = order.limitPriceE4!;
    const marketable = order.side === "buy" ? q.ask <= limit : q.bid >= limit;
    if (!marketable) continue;
    st.orders = st.orders.filter((o) => o.id !== order.id);
    if (order.side === "buy") {
      st.reservedCents -= order.reservedCents;
      st.cashCents += order.reservedCents;
    } else {
      const h = st.holdings.get(order.ticker);
      if (h) h.reserved -= order.quantity;
    }
    execute(order.ticker, order.side, order.quantity, limit, order.id);
  }
}

function addXp(base: number): number {
  const st = s();
  const amount = scaledXp(base);
  st.xpTotal += amount;
  return amount;
}

/** Books one fill. Price includes spread and impact already. */
function execute(ticker: string, side: OrderInput["side"], quantity: number, priceE4: number, orderId: string) {
  const st = s();
  const gross = Math.round((quantity * priceE4) / 100);
  const fee = trading.orderFeeCents;
  let tax = 0;
  let realized: number | null = null;
  const holding = st.holdings.get(ticker) ?? { quantity: 0, reserved: 0, lots: [] };

  if (side === "buy") {
    st.cashCents -= gross + fee;
    holding.quantity += quantity;
    holding.lots.push({ quantity, priceE4 });
  } else {
    let remaining = quantity;
    let cost = 0;
    while (remaining > 0 && holding.lots.length > 0) {
      const lot = holding.lots[0]!;
      const take = Math.min(lot.quantity, remaining);
      cost += (take * lot.priceE4) / 100;
      lot.quantity -= take;
      remaining -= take;
      if (lot.quantity === 0) holding.lots.shift();
    }
    holding.quantity -= quantity;
    realized = Math.round(gross - cost - fee);
    if (realized > 0) {
      const taxable = Math.max(0, realized - st.lossPotCents);
      st.lossPotCents = Math.max(0, st.lossPotCents - realized);
      tax = Math.round((taxable * trading.capitalGainsTaxBps) / 10_000);
    } else {
      st.lossPotCents += -realized;
    }
    st.cashCents += gross - fee - tax;
  }
  if (holding.quantity > 0) st.holdings.set(ticker, holding);
  else st.holdings.delete(ticker);

  // Impact: a buy pushes the price up, a sell down, and the push fades over the next ticks.
  const impact = impactBps(ticker, quantity) * (side === "buy" ? 1 : -1);
  st.mids.set(ticker, Math.max(10, Math.round(st.mids.get(ticker)! * (1 + impact / 20_000))));
  st.flow.set(ticker, (st.flow.get(ticker) ?? 0) + impact / 2);
  st.volume.set(ticker, (st.volume.get(ticker) ?? 0) + quantity);

  let xp = 0;
  if (st.tradesToday < progression.xpSources.trade.maxTradesPerDay && gross >= 10_000) {
    st.tradesToday += 1;
    xp = addXp(progression.xpSources.trade.xp);
  }
  st.trades.unshift({
    id: `${orderId}-fill`,
    ticker,
    side,
    quantity,
    priceE4,
    grossCents: gross,
    feeCents: fee,
    taxCents: tax,
    realizedPnlCents: realized,
    executedAt: new Date().toISOString(),
  });
  st.trades = st.trades.slice(0, 50);
  return { gross, fee, tax, realized, xp };
}

function requireLevel(key: string): void {
  const needed = unlockLevel(key);
  if (needed !== null && levelFromTotalXp(s().xpTotal) < needed) throw new GameError("locked");
}

function idempotent<T>(requestId: string, run: () => T): T {
  const st = s();
  if (st.requests.has(requestId)) return st.requests.get(requestId) as T;
  const result = run();
  st.requests.set(requestId, result);
  persist();
  return result;
}

/** Fill price of a market order: best quote plus half the impact of the order itself. */
export function demoFillPriceE4(ticker: string, side: OrderInput["side"], quantity: number): number {
  const q = quote(ticker);
  const impact = impactBps(ticker, quantity) / 2;
  return side === "buy"
    ? Math.round(q.ask * (1 + impact / 10_000))
    : Math.max(1, Math.round(q.bid * (1 - impact / 10_000)));
}

function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INTERVAL_SECONDS: Record<CandleInterval, number> = {
  "1m": 60,
  "5m": 300,
  "1h": 3600,
  "1q": 21_600,
  "1y": 86_400,
};

function demoCandles(ticker: string, interval: CandleInterval, limit: number): Candle[] {
  const st = s();
  const isIndex = ticker === "NEXA30";
  const last = isIndex ? st.indexValueE4 : quote(ticker).mid;
  const company = DEMO_COMPANIES.find((c) => c.ticker === ticker);
  const baseVol = isIndex ? 0.6 : company ? { bluechip: 1, midcap: 2, penny: 6 }[company.tier] : 0.05;
  const step = INTERVAL_SECONDS[interval];
  const volPerBar = (baseVol / 100) * Math.sqrt(step / 3600);
  let hash = 2166136261;
  for (const ch of `${ticker}:${interval}`) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  const random = seededRandom(hash);

  // Walk backwards from the current price so the newest candle ends exactly there.
  const end = Math.floor(Date.now() / 1000 / step) * step;
  const bars: Candle[] = [];
  let close = last;
  for (let i = 0; i < limit; i++) {
    const change = (random() + random() + random() - 1.5) * volPerBar * 1.6;
    const open = Math.max(1, Math.round(close / (1 + change)));
    const wick = Math.abs(change) * 0.6 + volPerBar * 0.3 * random();
    const high = Math.round(Math.max(open, close) * (1 + wick * random()));
    const low = Math.max(1, Math.round(Math.min(open, close) * (1 - wick * random())));
    bars.push({ time: end - i * step, open, high, low, close, volume: Math.round(random() * 5000) });
    close = open;
  }
  return bars.reverse();
}

const delay = <T>(value: () => T) =>
  new Promise<T>((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(value());
      } catch (error) {
        reject(error);
      }
    }, 120),
  );

export const demoEngine: GameEngine = {
  snapshot: () => Promise.resolve(snapshotNow()),

  candles: (ticker, interval, limit) => Promise.resolve(demoCandles(ticker, interval, limit)),

  orderBook: (ticker, levels) => {
    const q = quote(ticker);
    const depth = depthShares(ticker);
    const step = Math.max(1, Math.round(q.mid * 0.0008));
    const players = s().orders.filter((o) => o.ticker === ticker);
    const level = (i: number, side: "bid" | "ask") => {
      const priceE4 = side === "bid" ? q.bid - i * step : q.ask + i * step;
      const own = players.filter(
        (o) => (side === "bid" ? o.side === "buy" : o.side === "sell") && o.limitPriceE4 === priceE4,
      );
      return {
        priceE4,
        quantity: Math.round(depth * (0.15 + i * 0.08)) + own.reduce((sum, o) => sum + o.quantity, 0),
        players: own.length,
      };
    };
    const bids = Array.from({ length: levels }, (_, i) => level(i, "bid"));
    const asks = Array.from({ length: levels }, (_, i) => level(i, "ask"));
    // Resting player orders that sit between the synthetic levels
    for (const o of players) {
      const list = o.side === "buy" ? bids : asks;
      if (!list.some((l) => l.priceE4 === o.limitPriceE4))
        list.push({ priceE4: o.limitPriceE4!, quantity: o.quantity, players: 1 });
    }
    bids.sort((a, b) => b.priceE4 - a.priceE4);
    asks.sort((a, b) => a.priceE4 - b.priceE4);
    return Promise.resolve({ bids: bids.slice(0, levels), asks: asks.slice(0, levels) });
  },

  details: (ticker) => {
    const m = meta(ticker);
    const c = m.company;
    const marketCap = c ? Math.round((c.marketCapCents * quote(ticker).mid) / c.priceE4) : null;
    const pe = c ? { bluechip: 1650, midcap: 2100, penny: 0 }[c.tier] : null;
    return Promise.resolve({
      ticker,
      name: c?.name ?? m.bond!.name,
      description: null,
      marketCapCents: marketCap,
      sharesOutstanding: c ? Math.round(c.marketCapCents / (c.priceE4 / 100)) : null,
      peX100: pe || null,
      dividendYieldBps: c ? { bluechip: 280, midcap: 120, penny: 0 }[c.tier] : null,
      revenueCents: c ? Math.round(c.marketCapCents / 9) : null,
      netIncomeCents: c ? Math.round(c.marketCapCents / 70) : null,
      marginBps: c ? { bluechip: 1200, midcap: 800, penny: -400 }[c.tier] : null,
      news: [],
    });
  },

  portfolio: () => {
    const st = s();
    const now = Date.now();
    const capCents = economy.basicIncomeCentsPerHour * economy.vaultCapHours;
    const hours = Math.min(economy.vaultCapHours, (now - st.vaultClaimedAt) / HOUR);
    const positions = [...st.holdings].map(([ticker, h]) => {
      const m = meta(ticker);
      const q = quote(ticker);
      const cost = Math.round(h.lots.reduce((sum, lot) => sum + lot.quantity * lot.priceE4, 0) / 100);
      const value = Math.round((h.quantity * q.bid) / 100);
      return {
        ticker,
        name: m.company?.name ?? m.bond!.name,
        kind: m.kind,
        quantity: h.quantity,
        reservedQuantity: h.reserved,
        avgPriceE4: Math.round((cost * 100) / h.quantity),
        lastPriceE4: q.mid,
        marketValueCents: value,
        costBasisCents: cost,
        unrealizedPnlCents: value - cost,
      };
    });
    const positionsValue = positions.reduce((sum, p) => sum + p.marketValueCents, 0);
    const progress = levelProgress(st.xpTotal);
    const result: Portfolio = {
      cashCents: st.cashCents,
      reservedCents: st.reservedCents,
      positionsValueCents: positionsValue,
      totalCents: st.cashCents + st.reservedCents + positionsValue,
      lossPotCents: st.lossPotCents,
      vault: {
        accruedCents: Math.floor(hours * economy.basicIncomeCentsPerHour),
        capCents,
        rateCentsPerHour: economy.basicIncomeCentsPerHour,
        lastClaimedAt: new Date(st.vaultClaimedAt).toISOString(),
        fullAt: new Date(st.vaultClaimedAt + economy.vaultCapHours * HOUR).toISOString(),
        serverTime: new Date(now).toISOString(),
      },
      positions,
      openOrders: st.orders.map((order) => ({
        id: order.id,
        ticker: order.ticker,
        side: order.side,
        type: order.type,
        quantity: order.quantity,
        filledQuantity: order.filledQuantity,
        limitPriceE4: order.limitPriceE4,
        status: order.status,
        createdAt: order.createdAt,
      })),
      recentTrades: st.trades,
      level: progress.level,
      xpTotal: st.xpTotal,
      xpIntoLevel: progress.xpIntoLevel,
      xpForNext: progress.xpForNext,
      tutorialCompleted: st.tutorialCompleted,
    };
    return Promise.resolve(result);
  },

  placeOrder: (input) =>
    delay(() =>
      idempotent(input.requestId, (): OrderResult => {
        const st = s();
        const m = meta(input.ticker);
        if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100_000)
          throw new GameError("invalid_quantity");
        if (m.kind === "bond") requireLevel("bonds");
        if (input.type === "limit") requireLevel("limit_orders");
        const orderId = `demo-${input.requestId}`;
        const fee = trading.orderFeeCents;

        if (input.side === "sell") {
          const h = st.holdings.get(input.ticker);
          if (!h || h.quantity - h.reserved < input.quantity) throw new GameError("insufficient_position");
        }

        if (input.type === "limit") {
          const limit = input.limitPriceE4 ?? 0;
          if (limit <= 0) throw new GameError("invalid_price");
          const q = quote(input.ticker);
          const marketable = input.side === "buy" ? q.ask <= limit : q.bid >= limit;
          if (!marketable) {
            let reserved = 0;
            if (input.side === "buy") {
              reserved = Math.round((input.quantity * limit) / 100) + fee;
              if (reserved > st.cashCents) throw new GameError("insufficient_funds");
              st.cashCents -= reserved;
              st.reservedCents += reserved;
            } else {
              st.holdings.get(input.ticker)!.reserved += input.quantity;
            }
            st.orders.push({
              id: orderId,
              ticker: input.ticker,
              side: input.side,
              type: "limit",
              quantity: input.quantity,
              filledQuantity: 0,
              limitPriceE4: limit,
              status: "open",
              createdAt: new Date().toISOString(),
              reservedCents: reserved,
            });
            return {
              orderId,
              status: "open",
              filledQuantity: 0,
              avgPriceE4: null,
              grossCents: 0,
              feeCents: 0,
              taxCents: 0,
              realizedPnlCents: null,
              cashCents: st.cashCents,
              xpAwarded: 0,
              level: levelFromTotalXp(st.xpTotal),
              xpTotal: st.xpTotal,
            };
          }
        }

        let price = demoFillPriceE4(input.ticker, input.side, input.quantity);
        if (input.type === "limit" && input.limitPriceE4) {
          price = input.side === "buy" ? Math.min(price, input.limitPriceE4) : Math.max(price, input.limitPriceE4);
        }
        if (input.side === "buy" && Math.round((input.quantity * price) / 100) + fee > st.cashCents)
          throw new GameError("insufficient_funds");
        const fill = execute(input.ticker, input.side, input.quantity, price, orderId);
        return {
          orderId,
          status: "filled",
          filledQuantity: input.quantity,
          avgPriceE4: price,
          grossCents: fill.gross,
          feeCents: fill.fee,
          taxCents: fill.tax,
          realizedPnlCents: fill.realized,
          cashCents: st.cashCents,
          xpAwarded: fill.xp,
          level: levelFromTotalXp(st.xpTotal),
          xpTotal: st.xpTotal,
        };
      }),
    ),

  cancelOrder: (requestId, orderId) =>
    delay(() =>
      idempotent(requestId, () => {
        const st = s();
        const order = st.orders.find((o) => o.id === orderId);
        if (!order) throw new GameError("order_not_found");
        st.orders = st.orders.filter((o) => o.id !== orderId);
        if (order.side === "buy") {
          st.reservedCents -= order.reservedCents;
          st.cashCents += order.reservedCents;
        } else {
          const h = st.holdings.get(order.ticker);
          if (h) h.reserved -= order.quantity;
        }
      }),
    ),

  claimVault: (requestId) =>
    delay(() =>
      idempotent(requestId, () => {
        const st = s();
        const now = Date.now();
        const hours = Math.min(economy.vaultCapHours, (now - st.vaultClaimedAt) / HOUR);
        const claimed = Math.floor(hours * economy.basicIncomeCentsPerHour);
        if (claimed < 100) throw new GameError("nothing_to_claim");
        st.cashCents += claimed;
        st.vaultClaimedAt = now;
        return { claimedCents: claimed, cashCents: st.cashCents };
      }),
    ),

  completeTutorial: (requestId) =>
    delay(() =>
      idempotent(requestId, () => {
        const st = s();
        const xp = st.tutorialCompleted ? 0 : addXp(progression.xpSources.tutorial.xp);
        st.tutorialCompleted = true;
        return { xpAwarded: xp, level: levelFromTotalXp(st.xpTotal), xpTotal: st.xpTotal };
      }),
    ),
};

/** Test and showcase helper: forget the demo player (cash, positions, XP). */
export function resetDemoPlayer(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to forget.
  }
  state = null;
}
