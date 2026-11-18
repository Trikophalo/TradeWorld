import { INVESTOR_CONFIDENCE } from "@/config/investor-confidence";
import { confidenceTarget, stateFactors, topReasons } from "@/lib/sim/investor-confidence";
import type { MarketMood, MarketMoodBase, StockConfidence } from "../types";

/*
 * Demo of get_stock_confidence and get_market_mood (ADR-216). The demo market has no server job, so the mood is a
 * slow, deterministic wave over the clock (a bear phase every few days) and each stock's confidence comes from the
 * same factor formulas as on the server: mood, sector rotation, the day's price move (herd), chatter from its ticker
 * and a company reason that changes every few hours.
 */
const HOUR = 3_600_000;
const SECTORS = ["tech", "retail", "energy", "pharma", "logistics"] as const;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** Mood at a moment: a 5-day cycle plus a 19-hour ripple. */
export function demoMoodAt(ms: number): number {
  const t = ms / HOUR;
  return Math.max(4, Math.min(96, 50 + 22 * Math.sin((2 * Math.PI * t) / 120) + 6 * Math.sin((2 * Math.PI * t) / 19)));
}

function phaseOf(mood: number): MarketMoodBase["phase"] {
  return mood >= 60 ? "bull" : mood <= 38 ? "bear" : "calm";
}

export function demoMoodBase(nowMs: number): MarketMoodBase {
  const mood = demoMoodAt(nowMs);
  const history = Array.from({ length: 25 }, (_, i) => Math.round(demoMoodAt(nowMs - (24 - i) * HOUR) * 10) / 10);
  const block = Math.floor(nowMs / (24 * HOUR));
  const up = SECTORS[block % SECTORS.length]!;
  const down = SECTORS[(block + 2) % SECTORS.length]!;
  const tilt = INVESTOR_CONFIDENCE.mood.rotation.tilt;
  let start = nowMs;
  while (phaseOf(demoMoodAt(start - HOUR)) === phaseOf(mood) && start > nowMs - 96 * HOUR) start -= HOUR;
  return {
    mood: Math.round(mood * 10) / 10,
    phase: phaseOf(mood),
    phaseStartedAt: new Date(start).toISOString(),
    trend: Math.round((mood - history[0]!) * 10) / 10,
    history,
    sectors: [
      { sector: up, points: tilt },
      { sector: down, points: -tilt },
    ],
  };
}

/** Company reasons that change every six hours (earnings, news, payout, …), deterministic per ticker. */
const COMPANY_REASONS = ["earnings", "news", "market", "payout", "event", "management"] as const;

export interface DemoConfidenceInput {
  readonly ticker: string;
  readonly sector: string;
  readonly changeBps: number;
  /** Own player company: its reputation (0..100), else null. */
  readonly reputation: number | null;
}

function confidenceAt(input: DemoConfidenceInput, ms: number, market: MarketMoodBase) {
  const slot = Math.floor(ms / (6 * HOUR));
  const u = hash(`${input.ticker}:${slot}`);
  const reason = COMPANY_REASONS[Math.floor(u * COMPANY_REASONS.length)]!;
  const state = stateFactors({
    profitRecentCents: null,
    profitPriorCents: null,
    reputation: input.reputation,
    crisisSeverity: 0,
    countryRisk: null,
    talentTiers: 0,
    coCeo: false,
    volatility: null,
    mood: demoMoodAt(ms),
    sectorTilt: market.sectors.find((s) => s.sector === input.sector)?.points ?? 0,
    logReturn24h: Math.log(1 + input.changeBps / 10_000),
    logPremium: 0,
    chatter: (hash(`${input.ticker}:chatter:${Math.floor(ms / (2 * HOUR))}`) - 0.5) * 10,
  });
  const company = Math.round((hash(`${input.ticker}:${slot}:v`) - 0.5) * 30 * 10) / 10;
  const factors = { ...state, [reason]: company };
  return { value: confidenceTarget(factors), factors };
}

export function demoStockConfidence(input: DemoConfidenceInput, nowMs: number): StockConfidence {
  const market = demoMoodBase(nowMs);
  const now = confidenceAt(input, nowMs, market);
  const history = Array.from(
    { length: 25 },
    (_, i) => Math.round(confidenceAt(input, nowMs - (24 - i) * HOUR, market).value * 10) / 10,
  );
  const confidence = Math.round(now.value * 10) / 10;
  return {
    ticker: input.ticker,
    confidence,
    target: confidence,
    trend: Math.round((confidence - history[0]!) * 10) / 10,
    history,
    reasons: topReasons(now.factors),
    market,
  };
}

export function demoMarketMood(inputs: readonly (DemoConfidenceInput & { name: string })[], nowMs: number): MarketMood {
  const base = demoMoodBase(nowMs);
  const all = inputs.map((s) => ({
    ticker: s.ticker,
    name: s.name,
    confidence: demoStockConfidence(s, nowMs).confidence,
  }));
  const sorted = [...all].sort((a, b) => b.confidence - a.confidence || a.ticker.localeCompare(b.ticker));
  const avg = all.length > 0 ? all.reduce((s, x) => s + x.confidence, 0) / all.length : 50;
  return {
    ...base,
    avgConfidence: Math.round(avg * 10) / 10,
    confident: all.filter((x) => x.confidence >= 50).length,
    stocks: all.length,
    leaders: sorted.slice(0, 3),
    laggards: [...sorted].reverse().slice(0, 3),
  };
}
