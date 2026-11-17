/**
 * Awareness of a player company (ADR-188): one value 0..1 per company, the single source for demand, strengths,
 * diagnosis, Mira and news. One model, applied every closed hour:
 *
 *   marketing     rate(budget) × (cap − a)              diminishing returns: the closer to the cap, the less per hour
 *   word of mouth w × a × (1 − a / cap) × (0.5 + q) × price × served × (0.5 + reputation / 100)
 *   decay         d × (a − min)                          slow forgetting toward a floor
 *
 * Single events (tasks, campaigns, moves, interviews, news, protests, pitches) add or take at once through
 * `awarenessAdd`: never above the cap, never below the floor. Every change is booked by source per hour
 * (company_awareness_log), so the page can say "letzte Stunde: +1,2 Marketing, +0,5 Aufgaben, −0,2 Vergessen".
 *
 * The cap grows with the company: tier base (garage 60 %) + per skill stage + per expansion level.
 *
 * Mirrored 1:1 in SQL (company_awareness_cap, company_awareness_hour, company_awareness_add; migration
 * 20261204007700). Pure: no clock, no randomness.
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig } from "../../config/balance.ts";

export type AwarenessTier = "garage" | "small_business" | "gmbh" | "ag";

/** Sources of the awareness ledger (company_awareness_log.source). */
export const AWARENESS_SOURCES = [
  "marketing",
  "word_of_mouth",
  "decay",
  "tasks",
  "campaign",
  "moves",
  "interview",
  "news",
  "pitch",
  "protest",
  "event",
] as const;
export type AwarenessSource = (typeof AWARENESS_SOURCES)[number];

type AwarenessConfig = BalanceConfig["startups"]["awareness"];

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Highest awareness the company can reach: tier base + skill stages + expansion levels (at most cap.max). */
export function awarenessCap(
  tier: AwarenessTier,
  stage: number,
  expansionLevel = 0,
  cfg: AwarenessConfig = BALANCE.startups.awareness,
): number {
  const c = cfg.cap;
  const base = c.byTier[tier] ?? c.byTier.garage;
  const v =
    base + c.perStage * Math.max(0, Math.floor(stage)) + c.perExpansionLevel * Math.max(0, Math.floor(expansionLevel));
  return clamp(v, cfg.min, c.max);
}

/**
 * Share of the gap to the cap one hour of marketing closes (diminishing returns). `marketingCentsThisHour` is the
 * hour's budget; the half-saturation counts per quarter like the marketing slider.
 */
export function marketingRate(
  marketingCentsThisHour: number,
  effectivePotentialAnnualCents: number,
  cfg: AwarenessConfig = BALANCE.startups.awareness,
  quarterHours: number = BALANCE.time.quarterHours,
): number {
  const q = Math.max(0, marketingCentsThisHour) * Math.max(1, quarterHours);
  if (q <= 0) return 0;
  const half = Math.max(
    cfg.marketingMinHalfSaturationCents,
    (Math.max(0, effectivePotentialAnnualCents) / 4) * cfg.marketingHalfSaturationShare,
  );
  return (cfg.marketingMaxRatePerHour * q) / (q + half);
}

/** Marketing per quarter that buys half the possible rate: the sensible budget for growth. */
export function halfSaturationMarketingCents(
  effectivePotentialAnnualCents: number,
  cfg: AwarenessConfig = BALANCE.startups.awareness,
): number {
  return Math.max(
    cfg.marketingMinHalfSaturationCents,
    (Math.max(0, effectivePotentialAnnualCents) / 4) * cfg.marketingHalfSaturationShare,
  );
}

export interface AwarenessHourInput {
  readonly awareness: number;
  readonly cap: number;
  /** 0..1 */
  readonly quality: number;
  /** Price strategy's word-of-mouth factor (pricing.awareness). */
  readonly priceAwareness: number;
  readonly marketingCentsThisHour: number;
  readonly effectivePotentialAnnualCents: number;
  /** Share of the hour's demand that was served, 0..1 (unserved customers do not recommend). Default 1. */
  readonly servedShare?: number;
  /** Reputation 0..100, default 50 (neutral). */
  readonly reputation?: number;
}

/** What moved the awareness in one closed hour; all values are shares (0.012 = 1,2 Punkte). */
export interface AwarenessHour {
  readonly before: number;
  readonly next: number;
  readonly wordOfMouth: number;
  readonly marketing: number;
  /** Forgetting (positive number, subtracted). */
  readonly decay: number;
  readonly cap: number;
}

/** One closed hour of awareness: marketing, word of mouth and decay, capped. */
export function awarenessHour(
  input: AwarenessHourInput,
  cfg: AwarenessConfig = BALANCE.startups.awareness,
  quarterHours: number = BALANCE.time.quarterHours,
): AwarenessHour {
  const a = clamp(input.awareness, 0, 1);
  const cap = clamp(input.cap, cfg.min, 1);
  const gap = Math.max(0, cap - a);
  const marketing =
    marketingRate(input.marketingCentsThisHour, input.effectivePotentialAnnualCents, cfg, quarterHours) * gap;
  const wordOfMouth =
    cfg.wordOfMouthPerHour *
    a *
    Math.max(0, 1 - a / cap) *
    (0.5 + clamp(input.quality, 0, 1)) *
    Math.max(0, input.priceAwareness) *
    clamp(input.servedShare ?? 1, 0, 1) *
    (0.5 + clamp(input.reputation ?? 50, 0, 100) / 100);
  const decay = cfg.decayPerHour * Math.max(0, a - cfg.min);
  const next = clamp(a + marketing + wordOfMouth - decay, cfg.min, Math.max(cap, a));
  return { before: a, next, wordOfMouth, marketing, decay, cap };
}

/**
 * The change a single event really makes: a gain stops at the cap (nothing when already above it), a loss at the
 * floor. Returns the applied delta (new value = awareness + result).
 */
export function awarenessAdd(
  awareness: number,
  cap: number,
  delta: number,
  cfg: AwarenessConfig = BALANCE.startups.awareness,
): number {
  if (delta >= 0) return Math.max(0, Math.min(delta, cap - awareness));
  return Math.min(0, Math.max(delta, cfg.min - awareness));
}

/** Awareness as a share of the cap, 0..1 (the strength "Bekanntheit" and the diagnosis count with it). */
export function awarenessOfCap(awareness: number, cap: number): number {
  return clamp(awareness / Math.max(0.01, cap), 0, 1);
}
