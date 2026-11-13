import { BALANCE } from "@/config/balance";
import {
  MAX_QUANTITY_E6,
  MIN_ORDER_CENTS,
  QUANTITY_SCALE,
  quantityE6ForBudget,
  quantityE6ForProceeds,
  valueCents,
} from "@/features/market/order-schema";
import { DEMO_COMPANIES, DEMO_INDEX } from "@/lib/demo/market";
import { bondPriceE4, bondYieldBps } from "@/lib/sim/bonds";
import { withholdIncome } from "@/lib/sim/insolvency";
import { anchoredFairValue, playerImpactReturn } from "@/lib/sim/player-influence";
import { needsFullTimeFounder } from "@/lib/sim/startup";
import { basicIncomeCentsPerHour, upgradeCheck, upgradeCostCents, upgradeEffects } from "@/lib/sim/upgrades";
import { levelFromTotalXp, levelProgress, scaledXp, totalXpForLevel, unlockLevel } from "@/lib/sim/progression";
import { MISSION_TEMPLATES, availableFor, missionXp, type Metric, type MissionTemplate } from "./demo/missions";
import { createCareerEngine, initialCareer, tycoonAvatar, type CareerState } from "./demo/careers";
import { createArtEngine, type ArtState } from "./demo/artworks";
import { createPropertyEngine, type HomeState } from "./demo/property";
import { createFriendEngine } from "./demo/friends";
import { createSocialEngine, type DemoSocialState } from "./demo/social";
import { createCompanyEventsEngine } from "./demo/company-events";
import { tagFromUniform } from "@/lib/player-tag";
import { createCompanyEngine, type DemoCompanyState, type DemoDissolution } from "./demo/company";
import { demoTycoons } from "./demo/tycoons";
import {
  GameError,
  type Candle,
  type CandleInterval,
  type GameEngine,
  type UpgradeKey,
  type CompanyRankingEntry,
  type GameErrorKey,
  type MarketSnapshot,
  type Mission,
  type MissionGroup,
  type MissionKind,
  type OpenOrder,
  type OrderInput,
  type OrderResult,
  type Portfolio,
  type RichList,
  type RichListEntry,
  type Security,
  type Session,
  type Trade,
} from "./types";

/*
 * Offline engine for demo mode (no Supabase settings, docs/DECISIONS.md ADR-015).
 * It follows the server's rules in simple form, so the whole game can be tried
 * without an account: spread, price impact, fee, tax with loss pot, fractional
 * shares, limit orders, vault, XP, missions, rich list, names. The player's part
 * survives a reload (localStorage); market prices start fresh.
 */

const { trading, economy, time, progression, names } = BALANCE;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PRICE_SCALE = 10_000;
const BERLIN = time.timezone;

interface Holding {
  quantityE6: number;
  reservedE6: number;
  /** FIFO lots: quantity (e6) and price (e4) */
  lots: { quantityE6: number; priceE4: number }[];
}

type DemoOrder = OpenOrder & { reservedCents: number };

interface PlayerMission {
  id: string;
  key: string;
  kind: MissionKind;
  /** Metric value when the mission was assigned (progress counts from there). */
  base: number;
  status: Mission["status"];
  /** Day (YYYY-MM-DD) or week key of daily/weekly missions. */
  period: string | null;
}

interface PlayerState {
  nickname: string;
  /** Permanent player tag (ADR-085); drawn once for older demo players. */
  tag?: string;
  /** Feed, notifications and league of the demo (ADR-088, ADR-089). */
  social?: DemoSocialState;
  nicknameChangedAt: number | null;
  cashCents: number;
  reservedCents: number;
  lossPotCents: number;
  holdings: [string, Holding][];
  orders: DemoOrder[];
  trades: Trade[];
  vaultClaimedAt: number;
  xpTotal: number;
  tradesToday: number;
  tradesDay: string;
  tutorialCompleted: boolean;
  /** Lifetime counters for missions. */
  counters: Partial<Record<Metric, number>>;
  viewedToday: string[];
  missions: PlayerMission[];
  missionSeq: number;
  checkInDay: string | null;
  streakDays: number;
  /** Avatar, skills, daily reward, jobs (demo/careers.ts). */
  career?: CareerState;
  /** Bought upgrades (ADR-093). */
  upgrades?: Partial<Record<UpgradeKey, number>>;
  /** Level curve the XP were collected under (ADR-055). */
  curveVersion?: number;
  /** Own company (demo/company.ts, ADR-057). */
  company?: DemoCompanyState | null;
  /** Forced loan after an insolvency (ADR-058). */
  debtCents?: number;
  lastDissolution?: DemoDissolution | null;
  foundingLockedUntil?: number | null;
  /** Artworks, auctions, likes (demo/artworks.ts, ADR-080). */
  art?: ArtState;
  /** Own home, furniture, cars (demo/property.ts, ADR-082). */
  home?: HomeState;
}

interface MarketState {
  mids: Map<string, number>;
  prevClose: Map<string, number>;
  dayHigh: Map<string, number>;
  dayLow: Map<string, number>;
  volumeE6: Map<string, number>;
  /** Player-caused pressure in bps, decays every tick */
  flow: Map<string, number>;
  indexValueE4: number;
  indexStartE4: number;
  tickSeq: number;
}

const BONDS = [1, 2, 5, 10].map((years) => ({
  ticker: `NXB${String(years).padStart(2, "0")}`,
  name: years === 1 ? "Staatsanleihe 1 Jahr" : `Staatsanleihe ${years} Jahre`,
  years,
  couponBps: bondYieldBps(BALANCE.centralBank.startRateBps, years),
}));

const TYCOONS = demoTycoons();
const STORAGE_KEY = "nexa-demo-player-v2";
const CURVE_VERSION = 2;
const TUTORIAL_KEY = "nexa-tutorial";

// ------------------------------------------------------------------ state

function bondMid(couponBps: number, years: number): number {
  const remaining = years * BALANCE.bonds.couponsPerGameYear;
  return Number(bondPriceE4(couponBps, bondYieldBps(BALANCE.centralBank.startRateBps, years), remaining));
}

function initialMarket(): MarketState {
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
  const index = Math.round(DEMO_INDEX.points * PRICE_SCALE);
  return {
    mids,
    prevClose,
    dayHigh: new Map(mids),
    dayLow: new Map(mids),
    volumeE6: new Map(),
    flow: new Map(),
    indexValueE4: index,
    indexStartE4: index,
    tickSeq: 0,
  };
}

function initialPlayer(): PlayerState {
  return {
    nickname: "DemoSpieler",
    nicknameChangedAt: null,
    cashCents: economy.startingCapitalCents,
    reservedCents: 0,
    lossPotCents: 0,
    holdings: [],
    orders: [],
    trades: [],
    vaultClaimedAt: Date.now() - economy.vaultInitialHours * HOUR,
    xpTotal: 0,
    tradesToday: 0,
    tradesDay: "",
    tutorialCompleted: false,
    counters: {},
    viewedToday: [],
    missions: [],
    missionSeq: 0,
    checkInDay: null,
    streakDays: 0,
    curveVersion: CURVE_VERSION,
  };
}

/** ADR-055: the steeper level curve never takes a level away from an earlier demo player. */
function keepLevel(player: PlayerState): PlayerState {
  if (player.curveVersion === CURVE_VERSION) return player;
  // Saved before ADR-055: convert to the new curve without losing the level.
  const oldCurve = { ...progression, firstLevelXp: 100, xpBase: 100 };
  const oldLevel = levelFromTotalXp(player.xpTotal, oldCurve);
  return { ...player, xpTotal: Math.max(player.xpTotal, totalXpForLevel(oldLevel)), curveVersion: CURVE_VERSION };
}

function restorePlayer(): PlayerState {
  const player = initialPlayer();
  if (typeof window === "undefined") return player;
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as PlayerState | null;
    if (saved) return keepLevel({ ...player, ...saved, curveVersion: saved.curveVersion });
    // A finished tutorial from an earlier visit still counts.
    const tutorial = JSON.parse(window.localStorage.getItem(TUTORIAL_KEY) ?? "{}") as Record<
      string,
      { status?: string }
    >;
    if (tutorial.demo?.status === "done") {
      player.tutorialCompleted = true;
      player.xpTotal = scaledXp(progression.xpSources.tutorial.xp);
    }
  } catch {
    // Start fresh.
  }
  return player;
}

let market: MarketState | null = null;
let player: PlayerState | null = null;
const requests = new Map<string, unknown>();
const m = (): MarketState => (market ??= initialMarket());
const p = (): PlayerState => (player ??= restorePlayer());

function persist(): void {
  if (typeof window === "undefined" || !player) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(player));
  } catch {
    // Ignore: the demo simply forgets on reload.
  }
}

/** Account reset in the demo (ADR-070): a fresh player whose tutorial starts again. */
function startOver(confirm: string): void {
  if (confirm.trim().toLowerCase() !== p().nickname.toLowerCase()) throw new GameError("confirm_mismatch");
  try {
    const saved = JSON.parse(window.localStorage.getItem(TUTORIAL_KEY) ?? "{}") as Record<string, unknown>;
    delete saved.demo;
    window.localStorage.setItem(TUTORIAL_KEY, JSON.stringify(saved));
  } catch {
    // Nothing saved.
  }
  resetDemoPlayer();
}

/** Test and showcase helper: forget the demo player (cash, positions, XP). */
export function resetDemoPlayer(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to forget.
  }
  player = null;
  requests.clear();
}

// ------------------------------------------------------------------ helpers

const holdings = () => new Map(p().holdings);
const saveHoldings = (map: Map<string, Holding>) => {
  p().holdings = [...map];
};

function berlinDay(at = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BERLIN }).format(at);
}

function weekKey(at = Date.now()): string {
  const day = new Date(berlinDay(at));
  const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY);
  return monday.toISOString().slice(0, 10);
}

export function demoSession(now = new Date()): Session {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: BERLIN }).format(now),
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
  const info = meta(ticker);
  const base = info.company ? trading.spread.halfSpreadBps[info.company.tier] : 3;
  return demoSession() === "after_hours" ? base * time.afterHours.spreadMultiplier : base;
}

function quote(ticker: string) {
  const mid = m().mids.get(ticker)!;
  const half = Math.max(trading.spread.minHalfSpreadE4, Math.round((mid * halfSpreadBps(ticker)) / 10_000));
  return { mid, bid: Math.max(1, mid - half), ask: mid + half };
}

/** Shares (e6) whose purchase moves the price by 1 % (ADR-056); for the order book. */
function depthE6(ticker: string): number {
  const info = meta(ticker);
  const depthCents = info.company
    ? trading.playerImpact.depthCentsPer100Bps[info.company.tier]
    : trading.playerImpact.bondDepthCentsPer100Bps;
  const liquidity = demoSession() === "after_hours" ? time.afterHours.liquidityMultiplier : 1;
  return Math.max(1, (depthCents * 100 * liquidity) / m().mids.get(ticker)!) * QUANTITY_SCALE;
}

/** Price move of a player order in bps: measured in euros (ADR-056), stronger after hours. */
function impactBps(ticker: string, quantityE6: number): number {
  const info = meta(ticker);
  const mid = m().mids.get(ticker)!;
  const liquidity = demoSession() === "after_hours" ? time.afterHours.liquidityMultiplier : 1;
  const r = playerImpactReturn(quantityE6 / QUANTITY_SCALE, mid, info.company ? info.company.tier : "bond");
  return (r * 10_000) / liquidity;
}

/** Fill price of a market order: best quote plus half the impact of the order itself. */
function fillPriceE4(ticker: string, side: OrderInput["side"], quantityE6: number): number {
  const q = quote(ticker);
  const impact = impactBps(ticker, quantityE6) / 2;
  return side === "buy"
    ? Math.round(q.ask * (1 + impact / 10_000))
    : Math.max(1, Math.round(q.bid * (1 - impact / 10_000)));
}

function level(): number {
  return levelFromTotalXp(p().xpTotal);
}

function requireLevel(key: string): void {
  const needed = unlockLevel(key);
  if (needed !== null && level() < needed) throw new GameError("locked");
}

function addXp(base: number): number {
  const amount = scaledXp(base);
  const before = levelFromTotalXp(p().xpTotal);
  p().xpTotal += amount;
  const after = levelFromTotalXp(p().xpTotal);
  // Every few levels are news for the friends (ADR-088).
  for (let l = before + 1; l <= after; l++)
    if (l % BALANCE.social.feed.levelEvery === 0) feedPost("level_up", { level: l });
  return amount;
}

/** Posts to the demo feed once the engine exists (the feed module is created further down). */
function feedPost(kind: string, payload: Record<string, unknown>) {
  socialRef?.post(kind, payload);
}

/**
 * Private income (ADR-058): with an open forced loan, a share is kept back for repayment.
 * Returns what the player actually receives.
 */
function income(cents: number): number {
  const pl = p();
  const { netCents, repaidCents } = withholdIncome(BigInt(Math.round(cents)), BigInt(pl.debtCents ?? 0));
  pl.debtCents = Math.max(0, (pl.debtCents ?? 0) - Number(repaidCents));
  pl.cashCents += Number(netCents);
  return Number(netCents);
}

function bump(metric: Metric, by = 1): void {
  const counters = p().counters;
  counters[metric] = (counters[metric] ?? 0) + by;
}

function idempotent<T>(requestId: string, run: () => T): T {
  if (requests.has(requestId)) return requests.get(requestId) as T;
  const result = run();
  requests.set(requestId, result);
  persist();
  return result;
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

// ------------------------------------------------------------------ market

function securityOf(ticker: string): Security {
  const st = m();
  const info = meta(ticker);
  const q = quote(ticker);
  const prev = st.prevClose.get(ticker)!;
  return {
    id: `demo-${ticker}`,
    ticker,
    name: info.company?.name ?? info.bond!.name,
    kind: info.kind,
    sector: info.company?.sector ?? null,
    sizeClass: info.company?.tier ?? null,
    lastE4: q.mid,
    bidE4: q.bid,
    askE4: q.ask,
    prevCloseE4: prev,
    changeBps: Math.round((q.mid / prev - 1) * 10_000),
    dayHighE4: st.dayHigh.get(ticker)!,
    dayLowE4: st.dayLow.get(ticker)!,
    dayVolumeE6: st.volumeE6.get(ticker) ?? 0,
    marketCapCents: info.company ? Math.round((info.company.marketCapCents * q.mid) / info.company.priceE4) : null,
    bond: info.bond
      ? {
          termGameYears: info.bond.years,
          couponBps: info.bond.couponBps,
          yieldBps: bondYieldBps(BALANCE.centralBank.startRateBps, info.bond.years),
          maturesAt: new Date(Date.now() + info.bond.years * DAY).toISOString(),
          faceValueCents: BALANCE.bonds.faceValueCents,
        }
      : null,
    companyKind: "ai",
    logo: null,
  };
}

function snapshotNow(): MarketSnapshot {
  const st = m();
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
    securities: [...DEMO_COMPANIES.map((c) => securityOf(c.ticker)), ...BONDS.map((b) => securityOf(b.ticker))],
    economy: null,
  };
}

/**
 * One market step: noise by size class, pull toward the start price lifted by what the
 * player holds (ADR-056), decaying player flow.
 */
export function demoTick(): void {
  const st = m();
  st.tickSeq += 1;
  let indexMove = 0;
  const held = holdings();
  for (const c of DEMO_COMPANIES) {
    const mid = st.mids.get(c.ticker)!;
    const vol = { bluechip: 9, midcap: 20, penny: 60 }[c.tier];
    const noise = (Math.random() + Math.random() + Math.random() - 1.5) * vol;
    const heldShares = (held.get(c.ticker)?.quantityE6 ?? 0) / QUANTITY_SCALE;
    const target = anchoredFairValue(c.priceE4, heldShares, mid, c.tier);
    const anchor = Math.log(target / mid) * 60; // reversion to the (lifted) fair value
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
  if (p().orders.length > 0) {
    fillRestingOrders();
    persist();
  }
}

function fillRestingOrders(): void {
  const pl = p();
  for (const order of [...pl.orders]) {
    const q = quote(order.ticker);
    const limit = order.limitPriceE4!;
    const marketable = order.side === "buy" ? q.ask <= limit : q.bid >= limit;
    if (!marketable) continue;
    pl.orders = pl.orders.filter((o) => o.id !== order.id);
    if (order.side === "buy") {
      pl.reservedCents -= order.reservedCents;
      pl.cashCents += order.reservedCents;
    } else {
      const map = holdings();
      const h = map.get(order.ticker);
      if (h) h.reservedE6 -= order.quantityE6;
      saveHoldings(map);
    }
    execute(order.ticker, order.side, order.quantityE6, limit, order.id);
  }
}

/** Books one fill. The price already includes spread and impact. */
function execute(ticker: string, side: OrderInput["side"], quantityE6: number, priceE4: number, orderId: string) {
  const pl = p();
  const map = holdings();
  const gross = valueCents(quantityE6, priceE4);
  const fee = trading.orderFeeCents;
  let tax = 0;
  let realized: number | null = null;
  const holding = map.get(ticker) ?? { quantityE6: 0, reservedE6: 0, lots: [] };

  if (side === "buy") {
    pl.cashCents -= gross + fee;
    holding.quantityE6 += quantityE6;
    holding.lots.push({ quantityE6, priceE4 });
    bump("buys");
    bump("buy_value_cents", gross);
    if (meta(ticker).kind === "bond") bump("bond_buys");
  } else {
    let remaining = quantityE6;
    let cost = 0;
    while (remaining > 0 && holding.lots.length > 0) {
      const lot = holding.lots[0]!;
      const take = Math.min(lot.quantityE6, remaining);
      cost += valueCents(take, lot.priceE4);
      lot.quantityE6 -= take;
      remaining -= take;
      if (lot.quantityE6 === 0) holding.lots.shift();
    }
    holding.quantityE6 -= quantityE6;
    realized = gross - cost - fee;
    if (realized > 0) {
      const taxable = Math.max(0, realized - pl.lossPotCents);
      pl.lossPotCents = Math.max(0, pl.lossPotCents - realized);
      tax = Math.round((taxable * trading.capitalGainsTaxBps) / 10_000);
      bump("profit_cents", realized);
    } else {
      pl.lossPotCents += -realized;
    }
    income(gross - fee - tax); // a forced loan keeps back part of the proceeds (ADR-058)
    bump("sells");
  }
  if (holding.quantityE6 > 0) map.set(ticker, holding);
  else map.delete(ticker);
  saveHoldings(map);
  bump("trades");

  // Impact (ADR-056): the player moves the price at once; holding keeps it up (see demoTick).
  const st = m();
  const impact = impactBps(ticker, quantityE6) * (side === "buy" ? 1 : -1);
  st.mids.set(ticker, Math.max(10, Math.round(st.mids.get(ticker)! * Math.exp(impact / 10_000))));
  st.flow.set(ticker, (st.flow.get(ticker) ?? 0) + impact / 10);
  st.volumeE6.set(ticker, (st.volumeE6.get(ticker) ?? 0) + quantityE6);

  const today = berlinDay();
  if (pl.tradesDay !== today) {
    pl.tradesDay = today;
    pl.tradesToday = 0;
  }
  let xp = 0;
  if (
    pl.tradesToday < progression.xpSources.trade.maxTradesPerDay &&
    gross >= progression.xpSources.trade.minOrderValueCents
  ) {
    pl.tradesToday += 1;
    xp = addXp(progression.xpSources.trade.xp);
  }
  pl.trades.unshift({
    id: `${orderId}-${pl.trades.length}`,
    ticker,
    side,
    quantityE6,
    priceE4,
    grossCents: gross,
    feeCents: fee,
    taxCents: tax,
    realizedPnlCents: realized,
    executedAt: new Date().toISOString(),
  });
  pl.trades = pl.trades.slice(0, 50);
  const cost = gross - (realized ?? 0);
  if (
    realized !== null &&
    realized >= BALANCE.social.feed.bigTradeMinProfitCents &&
    cost > 0 &&
    (realized * 10_000) / cost >= BALANCE.social.feed.bigTradeMinBps
  ) {
    const sec = snapshotNow().securities.find((x) => x.ticker === ticker);
    feedPost("big_trade", {
      ticker,
      security_name: sec?.name ?? ticker,
      profit_cents: realized,
      profit_bps: Math.round((realized * 10_000) / cost),
    });
  }
  return { gross, fee, tax, realized, xp };
}

// ------------------------------------------------------------------ candles

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
  const isIndex = ticker === "NEXA30";
  const last = isIndex ? m().indexValueE4 : quote(ticker).mid;
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
    bars.push({ time: end - i * step, open, high, low, close, volume: Math.round(random() * 5000) * QUANTITY_SCALE });
    close = open;
  }
  return bars.reverse();
}

// ------------------------------------------------------------------ portfolio and wealth

/** Vault size and basic income with the upgrades (ADR-093). */
function vaultTerms() {
  const levels = p().upgrades ?? {};
  return { capHours: upgradeEffects(levels).vaultCapHours, rate: basicIncomeCentsPerHour(levels) };
}

function portfolioNow(): Portfolio {
  const pl = p();
  const now = Date.now();
  const vt = vaultTerms();
  const capCents = vt.rate * vt.capHours;
  const hours = Math.min(vt.capHours, (now - pl.vaultClaimedAt) / HOUR);
  const positions = [...holdings()].map(([ticker, h]) => {
    const info = meta(ticker);
    const q = quote(ticker);
    const cost = h.lots.reduce((sum, lot) => sum + valueCents(lot.quantityE6, lot.priceE4), 0);
    const value = valueCents(h.quantityE6, q.bid);
    return {
      ticker,
      name: info.company?.name ?? info.bond!.name,
      kind: info.kind,
      quantityE6: h.quantityE6,
      reservedQuantityE6: h.reservedE6,
      avgPriceE4: h.quantityE6 > 0 ? Math.round((cost * 100 * QUANTITY_SCALE) / h.quantityE6) : 0,
      lastPriceE4: q.mid,
      marketValueCents: value,
      costBasisCents: cost,
      unrealizedPnlCents: value - cost,
    };
  });
  const positionsValue = positions.reduce((sum, pos) => sum + pos.marketValueCents, 0);
  const progress = levelProgress(pl.xpTotal);
  const changeAvailable = pl.nicknameChangedAt === null ? null : pl.nicknameChangedAt + names.nicknameChangeDays * DAY;
  return {
    cashCents: pl.cashCents,
    reservedCents: pl.reservedCents,
    positionsValueCents: positionsValue,
    totalCents: pl.cashCents + pl.reservedCents + positionsValue,
    lossPotCents: pl.lossPotCents,
    vault: {
      accruedCents: Math.floor(hours * vt.rate),
      capCents,
      rateCentsPerHour: vt.rate,
      factorBps: 10_000,
      lastClaimedAt: new Date(pl.vaultClaimedAt).toISOString(),
      fullAt: new Date(pl.vaultClaimedAt + vt.capHours * HOUR).toISOString(),
      serverTime: new Date(now).toISOString(),
    },
    positions,
    openOrders: pl.orders.map((order) => ({
      id: order.id,
      ticker: order.ticker,
      side: order.side,
      type: order.type,
      quantityE6: order.quantityE6,
      filledQuantityE6: order.filledQuantityE6,
      limitPriceE4: order.limitPriceE4,
      status: order.status,
      createdAt: order.createdAt,
    })),
    recentTrades: pl.trades,
    level: progress.level,
    xpTotal: pl.xpTotal,
    xpIntoLevel: progress.xpIntoLevel,
    xpForNext: progress.xpForNext,
    tutorialCompleted: pl.tutorialCompleted,
    nickname: pl.nickname,
    nicknameChangeAvailableAt:
      changeAvailable !== null && changeAvailable > now ? new Date(changeAvailable).toISOString() : null,
    missionsClaimable: missionGroups().reduce(
      (sum, g) => sum + g.missions.filter((mission) => mission.status === "completed").length,
      0,
    ),
    streakDays: pl.streakDays,
    avatarKey: career.avatarKey(),
    skillPointsFree: career.freePoints(),
    dailyRewardClaimable: career.dailyClaimable(),
    companyValueCents: company.valueCents(),
    debtCents: pl.debtCents ?? 0,
    debtWithholdingBps: BALANCE.startups.insolvency.loanWithholdingBps,
    foundingLockedUntil:
      pl.foundingLockedUntil && pl.foundingLockedUntil > now ? new Date(pl.foundingLockedUntil).toISOString() : null,
  };
}

function netWorth(): number {
  const portfolio = portfolioNow();
  return portfolio.totalCents + portfolio.companyValueCents - portfolio.debtCents;
}

function sectorsHeld(): number {
  const sectors = new Set<string>();
  for (const [ticker] of holdings()) {
    const company = DEMO_COMPANIES.find((c) => c.ticker === ticker);
    if (company) sectors.add(company.sector);
  }
  return sectors.size;
}

/** Current value of a mission metric. */
function metricValue(metric: Metric): number {
  if (metric === "net_worth_cents") return netWorth();
  if (metric === "level") return level();
  if (metric === "sectors_held") return sectorsHeld();
  return p().counters[metric] ?? 0;
}

/** Metrics that count from assignment; the others are states (reached or not). */
const STATE_METRICS: readonly Metric[] = ["net_worth_cents", "level", "sectors_held"];

function richListNow(scope: "all" | "players"): RichList {
  const pl = p();
  const marketMove = m().indexValueE4 / m().indexStartE4;
  const entries: Omit<RichListEntry, "rank">[] = [];
  if (scope === "all") {
    for (const t of TYCOONS) {
      const factor = 1 + (marketMove - 1) * t.beta * 3;
      entries.push({
        kind: "tycoon",
        id: t.id,
        name: t.name,
        description: t.description,
        netWorthCents: Math.round(t.baseWealthCents * factor),
        change24hBps: Math.round((factor - 1) * 10_000),
        rankChange24h: null,
        isMe: false,
        avatarKey: tycoonAvatar(t.id),
      });
    }
  }
  const mine = netWorth();
  entries.push({
    kind: "player",
    id: "demo-player",
    name: pl.nickname,
    description: null,
    netWorthCents: mine,
    change24hBps: Math.round((mine / economy.startingCapitalCents - 1) * 10_000),
    rankChange24h: null,
    isMe: true,
    avatarKey: career.avatarKey(),
  });
  const ranked = entries.sort((a, b) => b.netWorthCents - a.netWorthCents).map((e, i) => ({ ...e, rank: i + 1 }));
  const me = ranked.find((e) => e.isMe)!;
  const above = ranked[me.rank - 2];
  return {
    serverTime: new Date().toISOString(),
    total: ranked.length,
    entries: ranked,
    me: {
      rank: me.rank,
      netWorthCents: me.netWorthCents,
      next: above ? { rank: above.rank, name: above.name, gapCents: above.netWorthCents - me.netWorthCents } : null,
    },
  };
}

// ------------------------------------------------------------------ missions

function periodOf(kind: MissionKind): string | null {
  if (kind === "daily") return berlinDay();
  if (kind === "weekly") return weekKey();
  return null;
}

function template(key: string): MissionTemplate {
  return MISSION_TEMPLATES.find((t) => t.key === key)!;
}

/** Fills every mission slot that is empty or expired. Deterministic order, no repeats while active. */
function assignMissions(): void {
  const pl = p();
  const lvl = level();
  const limits: Record<MissionKind, number> = {
    quick: progression.xpSources.quickMission.active,
    daily: progression.xpSources.dailyMission.perDay,
    weekly: progression.xpSources.weeklyMission.perWeek,
    milestone: progression.xpSources.milestoneMission.visible,
  };
  // Drop expired daily and weekly missions and replaced quick ones.
  pl.missions = pl.missions.filter((mission) => {
    if (mission.kind === "daily" || mission.kind === "weekly") return mission.period === periodOf(mission.kind);
    if (mission.kind === "quick") return mission.status !== "claimed";
    return true;
  });
  for (const kind of ["quick", "daily", "weekly", "milestone"] as const) {
    const current = pl.missions.filter(
      (mission) => mission.kind === kind && (kind !== "milestone" || mission.status !== "claimed"),
    );
    const used = new Set(pl.missions.filter((mission) => mission.kind === kind).map((mission) => mission.key));
    const pool = MISSION_TEMPLATES.filter((t) => t.kind === kind && availableFor(t, lvl) && !used.has(t.key));
    for (let i = current.length; i < limits[kind] && pool.length > 0; i++) {
      // Quick missions rotate through the pool; the others take the next ones in order.
      const pick = kind === "quick" ? pool.splice(pl.missionSeq % pool.length, 1)[0]! : pool.shift()!;
      pl.missionSeq += 1;
      pl.missions.push({
        id: `mission-${pl.missionSeq}`,
        key: pick.key,
        kind,
        base: STATE_METRICS.includes(pick.metric) ? 0 : metricValue(pick.metric),
        status: "active",
        period: periodOf(kind),
      });
    }
    // Quick missions whose pool ran dry start over.
    if (kind === "quick" && pool.length === 0 && current.length < limits.quick) {
      pl.missions = pl.missions.filter((mission) => mission.kind !== "quick" || mission.status !== "claimed");
    }
  }
}

function missionGroups(): MissionGroup[] {
  const pl = p();
  assignMissions();
  const resets: Record<MissionKind, string | null> = {
    quick: null,
    daily: new Date(new Date(`${berlinDay()}T00:00:00`).getTime() + DAY).toISOString(),
    weekly: new Date(new Date(`${weekKey()}T00:00:00`).getTime() + 7 * DAY).toISOString(),
    milestone: null,
  };
  return (["quick", "daily", "weekly", "milestone"] as const).map((kind) => ({
    kind,
    resetsAt: resets[kind],
    missions: pl.missions
      .filter((mission) => mission.kind === kind && (kind !== "milestone" || mission.status !== "claimed"))
      .map((mission) => {
        const t = template(mission.key);
        const progress = Math.min(t.target, Math.max(0, metricValue(t.metric) - mission.base));
        if (mission.status === "active" && progress >= t.target) mission.status = "completed";
        return {
          id: mission.id,
          key: mission.key,
          title: t.title,
          description: null,
          progress,
          target: t.target,
          xp: missionXp(t),
          status: mission.status,
          expiresAt: resets[kind],
        };
      }),
  }));
}

// ------------------------------------------------------------------ names

/** Small offline blocklist; the server has the full one (ADR-043). */
const DEMO_BLOCKED = [
  "admin",
  "moderator",
  "support",
  "finn",
  "nexa",
  "arsch",
  "fick",
  "hure",
  "nazi",
  "hitler",
  "fuck",
  "shit",
  "bitch",
];

function nameViolation(name: string): GameErrorKey | null {
  if (name.length < names.minLength) return "name_too_short";
  if (name.length > names.maxLength) return "name_too_long";
  if (!/^[A-Za-z0-9_]+$/.test(name)) return "name_invalid_chars";
  const normalised = name
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/[^a-z]/g, "")
    .replace(/(.)\1+/g, "$1");
  if (["admin", "moderator", "support", "finn", "nexa"].some((term) => normalised === term)) return "name_reserved";
  if (DEMO_BLOCKED.some((term) => normalised.includes(term))) return "name_profanity";
  return null;
}

// ------------------------------------------------------------------ engine

function doCheckIn() {
  const pl = p();
  const today = berlinDay();
  if (pl.checkInDay === today) {
    return { xpAwarded: 0, level: level(), xpTotal: pl.xpTotal, streakDays: pl.streakDays, alreadyCheckedIn: true };
  }
  const yesterday = berlinDay(Date.now() - DAY);
  pl.streakDays = pl.checkInDay === yesterday ? pl.streakDays + 1 : 1;
  pl.checkInDay = today;
  bump("check_ins");
  if ((BALANCE.social.feed.streakMilestones as readonly number[]).includes(pl.streakDays))
    feedPost("streak", { days: pl.streakDays });
  const login = progression.xpSources.dailyLogin;
  const xp = addXp(login.xp + Math.min(login.streakBonusCap, (pl.streakDays - 1) * login.streakBonusPerDay));
  return { xpAwarded: xp, level: level(), xpTotal: pl.xpTotal, streakDays: pl.streakDays, alreadyCheckedIn: false };
}

// ------------------------------------------------------------------ careers

const career = createCareerEngine({
  state: () => (p().career ??= initialCareer()),
  nickname: () => p().nickname,
  tag: () => myTag(),
  trophies: () => social.trophies(),
  level,
  addXp,
  xpTotal: () => p().xpTotal,
  cashCents: () => p().cashCents,
  addCash: (cents) => {
    if (cents > 0) income(cents);
    else p().cashCents += cents;
  },
  netWorthCents: () => netWorth(),
  rank: () => richListNow("all").me?.rank ?? null,
  streakDays: () => p().streakDays,
  checkIn: () => void doCheckIn(),
  day: (at) => berlinDay(at),
  week: (at) => weekKey(at),
  idempotent,
  persist,
  // Founders may work elsewhere until their company has 5 employees (ADR-066).
  ownsCompany: () => needsFullTimeFounder(p().company?.aiWorkers ?? 0) && Boolean(p().company),
  ownCompany: () => {
    const own = p().company;
    return own ? { name: own.name, ticker: own.listing?.ticker ?? null } : null;
  },
  upgrades: () => p().upgrades ?? {},
  feedPost: (kind, payload) => feedPost(kind, payload),
});

// ------------------------------------------------------------------ upgrades (ADR-093)

const UPGRADE_KEYS = BALANCE.upgrades.order;
const upgradeLevelsNow = () =>
  Object.fromEntries(UPGRADE_KEYS.map((k) => [k, p().upgrades?.[k] ?? 0])) as Record<UpgradeKey, number>;

const upgradeEngine: Pick<GameEngine, "upgrades" | "buyUpgrade"> = {
  upgrades: () => delay(() => ({ levels: upgradeLevelsNow() })),
  buyUpgrade: (requestId, key) =>
    delay(() =>
      idempotent(requestId, () => {
        const pl = p();
        if (!UPGRADE_KEYS.includes(key)) throw new GameError("invalid_argument");
        const current = pl.upgrades?.[key] ?? 0;
        const check = upgradeCheck(key, current, level(), pl.cashCents);
        if (check === "maxed") throw new GameError("upgrade_maxed");
        if (check === "level") throw new GameError("locked");
        if (check === "cash") throw new GameError("insufficient_funds");
        const cost = upgradeCostCents(key, current)!;
        // Claim the vault at the old terms first, so a bigger vault does not pay hours that were already lost.
        if (key === "vault" || key === "income") {
          const vt = vaultTerms();
          const hours = Math.min(vt.capHours, (Date.now() - pl.vaultClaimedAt) / HOUR);
          pl.vaultClaimedAt = Date.now() - Math.max(0, hours) * HOUR;
        }
        pl.cashCents -= cost;
        pl.upgrades = { ...pl.upgrades, [key]: current + 1 };
        return { key, level: current + 1, costCents: cost, levels: upgradeLevelsNow() };
      }),
    ),
};

const company = createCompanyEngine({
  eventModifiers: (c, at) => companyEvents.modifiers(c, at),
  company: () => p().company ?? null,
  setCompany: (value) => {
    p().company = value;
  },
  level,
  cashCents: () => p().cashCents,
  addCash: (cents) => {
    if (cents > 0) income(cents);
    else p().cashCents += cents;
  },
  addXp,
  hasJob: () => career.hasJob(),
  branchScores: () => career.branchScores(),
  learnedSkills: () => career.learnedSkills(),
  nameViolation,
  idempotent,
  persist,
  nickname: () => p().nickname,
  avatarKey: () => career.avatarKey(),
  addDebt: (cents) => {
    p().debtCents = (p().debtCents ?? 0) + cents;
  },
  lastDissolution: () => p().lastDissolution ?? null,
  setLastDissolution: (value) => {
    p().lastDissolution = value;
  },
  foundingLockedUntil: () => p().foundingLockedUntil ?? null,
  lockFounding: (until) => {
    p().foundingLockedUntil = until;
  },
  startFounderNotice: () => career.startNotice(),
});

const companyEvents = createCompanyEventsEngine({
  company: () => p().company ?? null,
  branchScores: () => career.branchScores(),
  headcount: (c) => 1 + c.aiWorkers,
  fixedCostCentsPerQuarter: (c) => company.fixedCostCents(c.tier, BALANCE, c.expansionLevel ?? 0),
  idempotent,
  persist,
});

/** Demo only (ADR-091): start a company crisis or chance now, or finish the running response step. */
export function demoTriggerCompanyEvent(archetype?: string): void {
  companyEvents.triggerNow(archetype);
}
export function demoFinishEventStep(): void {
  companyEvents.finishStepNow();
}

const art = createArtEngine({
  art: () => p().art,
  setArt: (value) => {
    p().art = value;
  },
  nickname: () => p().nickname,
  level,
  cashCents: () => p().cashCents,
  addCash: (cents) => {
    p().cashCents += cents;
  },
  collectors: () => TYCOONS.slice(0, 16).map((t) => t.name),
  nameViolation,
  day: berlinDay,
  idempotent,
  persist,
  track: (metric) => bump(metric),
});

/** The demo player's tag, drawn once (ADR-085). */
function myTag(): string {
  const pl = p();
  if (!pl.tag) {
    pl.tag = tagFromUniform([Math.random(), Math.random(), Math.random(), Math.random()]);
    persist();
  }
  return pl.tag;
}

let socialRef: ReturnType<typeof createSocialEngine> | null = null;
const social = createSocialEngine({
  state: () => (p().social ??= { seq: 0, feed: [], notifications: [] }),
  nickname: () => p().nickname,
  tag: myTag,
  level,
  avatarKey: () => career.avatarKey(),
  netWorthCents: () => netWorth(),
  snapshot: () => snapshotNow(),
  idempotent,
  persist,
});
socialRef = social;

const friends = createFriendEngine({
  nickname: () => p().nickname,
  tag: myTag,
  level,
  avatarKey: () => career.avatarKey(),
  idempotent,
});

const home = createPropertyEngine({
  home: () => p().home,
  setHome: (value) => {
    p().home = value;
  },
  nickname: () => p().nickname,
  level,
  cashCents: () => p().cashCents,
  addCash: (cents) => {
    p().cashCents += cents;
  },
  idempotent,
  persist,
});

/** Demo only: close the current company quarter at once (button on the company page). */
export function demoCloseQuarter(): void {
  company.closeQuarterNow();
}

export const demoEngine: GameEngine = {
  ...career.engine,
  ...upgradeEngine,
  ...company.engine,
  ...art.engine,
  ...home.engine,
  ...friends,
  ...social.engine,
  ...companyEvents.engine,
  snapshot: () => Promise.resolve(snapshotNow()),

  candles: (ticker, interval, limit) => Promise.resolve(demoCandles(ticker, interval, limit)),

  orderBook: (ticker, levels) => {
    const q = quote(ticker);
    const depth = depthE6(ticker);
    const step = Math.max(1, Math.round(q.mid * 0.0008));
    const players = p().orders.filter((o) => o.ticker === ticker);
    const level = (i: number, side: "bid" | "ask") => {
      const priceE4 = side === "bid" ? q.bid - i * step : q.ask + i * step;
      const own = players.filter(
        (o) => (side === "bid" ? o.side === "buy" : o.side === "sell") && o.limitPriceE4 === priceE4,
      );
      return {
        priceE4,
        quantityE6: Math.round(depth * (0.15 + i * 0.08)) + own.reduce((sum, o) => sum + o.quantityE6, 0),
        players: own.length,
      };
    };
    const bids = Array.from({ length: levels }, (_, i) => level(i, "bid"));
    const asks = Array.from({ length: levels }, (_, i) => level(i, "ask"));
    for (const o of players) {
      const list = o.side === "buy" ? bids : asks;
      if (!list.some((l) => l.priceE4 === o.limitPriceE4))
        list.push({ priceE4: o.limitPriceE4!, quantityE6: o.quantityE6, players: 1 });
    }
    bids.sort((a, b) => b.priceE4 - a.priceE4);
    asks.sort((a, b) => a.priceE4 - b.priceE4);
    return Promise.resolve({ bids: bids.slice(0, levels), asks: asks.slice(0, levels) });
  },

  details: (ticker) => {
    const info = meta(ticker);
    const c = info.company;
    const marketCap = c ? Math.round((c.marketCapCents * quote(ticker).mid) / c.priceE4) : null;
    return Promise.resolve({
      ticker,
      name: c?.name ?? info.bond!.name,
      description: null,
      marketCapCents: marketCap,
      sharesOutstanding: c ? Math.round(c.marketCapCents / (c.priceE4 / 100)) : null,
      peX100: c ? { bluechip: 1650, midcap: 2100, penny: null }[c.tier] : null,
      dividendYieldBps: c ? { bluechip: 280, midcap: 120, penny: 0 }[c.tier] : null,
      revenueCents: c ? Math.round(c.marketCapCents / 9) : null,
      netIncomeCents: c ? Math.round(c.marketCapCents / 70) : null,
      marginBps: c ? { bluechip: 1200, midcap: 800, penny: -400 }[c.tier] : null,
      news: [],
    });
  },

  portfolio: () => {
    career.accrue();
    return Promise.resolve(portfolioNow());
  },

  placeOrder: (input) =>
    delay(() =>
      idempotent(input.requestId, (): OrderResult => {
        const pl = p();
        const info = meta(input.ticker);
        if (info.kind === "bond") requireLevel("bonds");
        if (input.type === "limit") requireLevel("limit_orders");
        const hasQuantity = input.quantityE6 != null;
        const hasAmount = input.amountCents != null;
        if (hasQuantity === hasAmount) throw new GameError("invalid_argument");
        const fee = trading.orderFeeCents;
        const orderId = `demo-${input.requestId}`;
        const limit = input.type === "limit" ? (input.limitPriceE4 ?? 0) : null;
        if (limit !== null && limit <= 0) throw new GameError("invalid_price");

        // Price used to turn an amount into shares: the limit, or the estimated fill.
        const q = quote(input.ticker);
        const roughPrice = limit ?? (input.side === "buy" ? q.ask : q.bid);
        let quantityE6 = hasQuantity
          ? Math.round(input.quantityE6!)
          : input.side === "buy"
            ? quantityE6ForBudget(input.amountCents!, roughPrice, fee)
            : quantityE6ForProceeds(input.amountCents!, roughPrice);
        if (quantityE6 <= 0 || quantityE6 > MAX_QUANTITY_E6) throw new GameError("invalid_quantity");

        const map = holdings();
        const free = (map.get(input.ticker)?.quantityE6 ?? 0) - (map.get(input.ticker)?.reservedE6 ?? 0);
        if (input.side === "sell") {
          // Selling (almost) everything sells everything: no dust left behind.
          if (quantityE6 > free && quantityE6 <= free * 1.001) quantityE6 = free;
          if (quantityE6 > free) throw new GameError("insufficient_position");
        }
        if (hasAmount) bump("amount_orders");

        if (limit !== null && !(input.side === "buy" ? q.ask <= limit : q.bid >= limit)) {
          if (valueCents(quantityE6, limit) < MIN_ORDER_CENTS) throw new GameError("order_too_small");
          let reserved = 0;
          if (input.side === "buy") {
            reserved = valueCents(quantityE6, limit) + fee;
            if (reserved > pl.cashCents) throw new GameError("insufficient_funds");
            pl.cashCents -= reserved;
            pl.reservedCents += reserved;
          } else {
            const h = map.get(input.ticker)!;
            h.reservedE6 += quantityE6;
            saveHoldings(map);
          }
          pl.orders.push({
            id: orderId,
            ticker: input.ticker,
            side: input.side,
            type: "limit",
            quantityE6,
            filledQuantityE6: 0,
            limitPriceE4: limit,
            status: "open",
            createdAt: new Date().toISOString(),
            reservedCents: reserved,
          });
          bump("limit_orders");
          return {
            orderId,
            status: "open",
            quantityE6,
            filledQuantityE6: 0,
            avgPriceE4: null,
            grossCents: 0,
            feeCents: 0,
            taxCents: 0,
            realizedPnlCents: null,
            cashCents: pl.cashCents,
            xpAwarded: 0,
            level: level(),
            xpTotal: pl.xpTotal,
          };
        }

        let price = fillPriceE4(input.ticker, input.side, quantityE6);
        if (limit !== null) price = input.side === "buy" ? Math.min(price, limit) : Math.max(price, limit);
        // An amount buy spends exactly the amount at the real fill price.
        if (hasAmount && input.side === "buy") quantityE6 = quantityE6ForBudget(input.amountCents!, price, fee);
        if (quantityE6 <= 0 || valueCents(quantityE6, price) < MIN_ORDER_CENTS) throw new GameError("order_too_small");
        if (input.side === "buy" && valueCents(quantityE6, price) + fee > pl.cashCents)
          throw new GameError("insufficient_funds");
        if (input.type === "limit") bump("limit_orders");
        const fill = execute(input.ticker, input.side, quantityE6, price, orderId);
        return {
          orderId,
          status: "filled",
          quantityE6,
          filledQuantityE6: quantityE6,
          avgPriceE4: price,
          grossCents: fill.gross,
          feeCents: fill.fee,
          taxCents: fill.tax,
          realizedPnlCents: fill.realized,
          cashCents: pl.cashCents,
          xpAwarded: fill.xp,
          level: level(),
          xpTotal: pl.xpTotal,
        };
      }),
    ),

  cancelOrder: (requestId, orderId) =>
    delay(() =>
      idempotent(requestId, () => {
        const pl = p();
        const order = pl.orders.find((o) => o.id === orderId);
        if (!order) throw new GameError("order_not_found");
        pl.orders = pl.orders.filter((o) => o.id !== orderId);
        if (order.side === "buy") {
          pl.reservedCents -= order.reservedCents;
          pl.cashCents += order.reservedCents;
        } else {
          const map = holdings();
          const h = map.get(order.ticker);
          if (h) h.reservedE6 -= order.quantityE6;
          saveHoldings(map);
        }
      }),
    ),

  claimVault: (requestId) =>
    delay(() =>
      idempotent(requestId, () => {
        const pl = p();
        const now = Date.now();
        const vt = vaultTerms();
        const hours = Math.min(vt.capHours, (now - pl.vaultClaimedAt) / HOUR);
        const claimed = Math.floor(hours * vt.rate);
        if (claimed < economy.vaultMinClaimCents) throw new GameError("nothing_to_claim");
        const received = income(claimed);
        socialRef?.inflow(received);
        pl.vaultClaimedAt = now;
        bump("vault_claims");
        return { claimedCents: received, cashCents: pl.cashCents };
      }),
    ),

  completeTutorial: (requestId) =>
    delay(() =>
      idempotent(requestId, () => {
        const pl = p();
        const xp = pl.tutorialCompleted ? 0 : addXp(progression.xpSources.tutorial.xp);
        pl.tutorialCompleted = true;
        return { xpAwarded: xp, level: level(), xpTotal: pl.xpTotal };
      }),
    ),

  // AI companies by market value plus the own company (ADR-074); other players do not exist in the demo.
  companyRanking: async (scope, limit) => {
    const snap = snapshotNow();
    const own = (await company.engine.myCompany()).company;
    const colors = new Map(DEMO_COMPANIES.map((c) => [c.ticker, c.color]));
    const rows: Omit<CompanyRankingEntry, "rank">[] = [
      ...(scope === "players"
        ? []
        : snap.securities
            .filter((sec) => sec.kind === "stock" && sec.marketCapCents !== null && sec.companyKind === "ai")
            .map((sec) => ({
              companyId: sec.id,
              kind: "ai" as const,
              name: sec.name,
              color: colors.get(sec.ticker) ?? "#8f7bff",
              logo: null,
              ticker: sec.ticker,
              sector: sec.sector,
              tier: null,
              founder: null,
              valueCents: sec.marketCapCents ?? 0,
              revenueCents: null,
              teamSize: null,
              isMine: false,
            }))),
      ...(own
        ? [
            {
              companyId: own.id,
              kind: "player" as const,
              name: own.name,
              color: own.color,
              logo: own.logo,
              ticker: own.listing?.ticker ?? null,
              sector: own.sector,
              tier: own.tier,
              founder: p().nickname,
              valueCents: own.valueCents,
              revenueCents: own.lastQuarter?.revenueCents ?? null,
              teamSize: own.employees + own.aiWorkers + 1,
              isMine: true,
            },
          ]
        : []),
    ];
    const entries = rows.sort((a, b) => b.valueCents - a.valueCents).map((row, i) => ({ ...row, rank: i + 1 }));
    const mine = entries.find((e) => e.isMine);
    return {
      serverTime: snap.serverTime,
      total: entries.length,
      entries: entries.slice(0, limit),
      mine: mine ? { rank: mine.rank, valueCents: mine.valueCents } : null,
    };
  },

  richList: (scope, limit, offset) => {
    const list = richListNow(scope);
    return Promise.resolve({ ...list, entries: list.entries.slice(offset, offset + limit) });
  },

  richNews: () => {
    const list = richListNow("all");
    const me = list.me!;
    const news = [
      {
        publishedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
        headline: `${list.entries[0]!.name} bleibt die Nummer eins`,
        body: "Das größte Vermögen der Spielwelt steckt vor allem in Aktien der KI-Firmen.",
        kind: "leader",
      },
    ];
    if (me.next) {
      news.unshift({
        publishedAt: new Date().toISOString(),
        headline: `${p().nickname} jagt Platz ${me.next.rank}`,
        body: `Bis ${me.next.name} fehlen noch ${Math.round(me.next.gapCents / 100).toLocaleString("de-DE")} €.`,
        kind: "chase",
      });
    }
    return Promise.resolve(news);
  },

  checkNickname: (nickname) => {
    const reason = nameViolation(nickname);
    return Promise.resolve({ allowed: reason === null, reason });
  },

  changeNickname: (requestId, nickname) =>
    delay(() =>
      idempotent(requestId, () => {
        const pl = p();
        const now = Date.now();
        if (pl.nicknameChangedAt !== null && now < pl.nicknameChangedAt + names.nicknameChangeDays * DAY)
          throw new GameError("name_change_too_soon");
        const reason = nameViolation(nickname);
        if (reason) throw new GameError(reason);
        pl.nickname = nickname;
        pl.nicknameChangedAt = now;
        return { nickname, nextChangeAt: new Date(now + names.nicknameChangeDays * DAY).toISOString() };
      }),
    ),

  // The demo has no account: both start over with a fresh demo player (ADR-070).
  resetAccount: (_requestId, confirm) => delay(() => startOver(confirm)),
  deleteAccount: (confirm) => delay(() => startOver(confirm)),

  missions: () => Promise.resolve(missionGroups()),

  claimMission: (requestId, missionId) =>
    delay(() =>
      idempotent(requestId, () => {
        const pl = p();
        missionGroups(); // refresh progress and status
        const mission = pl.missions.find((x) => x.id === missionId);
        if (!mission) throw new GameError("mission_not_found");
        if (mission.status === "claimed") throw new GameError("mission_already_claimed");
        if (mission.status !== "completed") throw new GameError("mission_not_completed");
        mission.status = "claimed";
        const xp = addXp(template(mission.key).xp);
        return { xpAwarded: xp, level: level(), xpTotal: pl.xpTotal };
      }),
    ),

  checkIn: (requestId) => delay(() => idempotent(requestId, doCheckIn)),

  track: (event, ref) => {
    const pl = p();
    if (event === "view_security" && ref) {
      const key = `${berlinDay()}:${ref}`;
      if (!pl.viewedToday.includes(key)) {
        pl.viewedToday = [...pl.viewedToday.filter((v) => v.startsWith(berlinDay())), key];
        bump("views");
      }
    } else if (event === "open_rich_list") bump("rich_list_views");
    else if (event === "open_rules") bump("rules_views");
    persist();
    return Promise.resolve();
  },
};
