/**
 * Company strengths (ADR-176): six scores 0..100 the server keeps per player company and moves once per closed hour.
 * The value an hour shows (its "instant" value) is only a target: a score closes `gainPerHour` of the gap when the
 * hour was better and `decayPerHour` when it was worse. With 2 % per hour, 99 takes about ten days of good hours;
 * neglect costs faster. A high overall score (floor of the mean) pays a bonus on the hour's revenue.
 * ADR-188: "Bekanntheit" is the awareness as a share of the company's cap (awarenessOfCap) and follows it with
 * `awarenessFollowPerHour` (25 % of the gap per hour, both ways), so the score and the awareness never contradict.
 *
 * Mirrored 1:1 in SQL (company_strengths_instant, company_strengths_step, company_strengths_reward_bps;
 * migration 20261204006600). Pure: no clock, no randomness, no imports besides the config.
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig } from "../../config/balance.ts";

export const STRENGTH_KEYS = ["awareness", "quality", "delivery", "margin", "team", "finance"] as const;
export type StrengthKey = (typeof STRENGTH_KEYS)[number];
export type StrengthScores = Readonly<Record<StrengthKey, number>>;

type StrengthsConfig = BalanceConfig["companyHealth"]["strengths"];

/** What a closed hour shows. Money in cents. */
export interface StrengthHour {
  /** Awareness as a share of its cap, 0..1 (ADR-188, awarenessOfCap in awareness.ts). */
  readonly awareness: number;
  /** 0..1 */
  readonly quality: number;
  readonly demandCents: number;
  readonly capacityCents: number;
  readonly revenueCents: number;
  readonly profitCents: number;
  /** Share of the wages paid (bps, 10 000 = all). */
  readonly payFactorBps: number;
  readonly cashCents: number;
  /** Open bills after the hour. */
  readonly unpaidCents: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const EMPTY_STRENGTHS: StrengthScores = {
  awareness: 0,
  quality: 0,
  delivery: 0,
  margin: 0,
  team: 0,
  finance: 0,
};

/** The values the hour shows, 0..100 each. */
export function strengthsInstant(h: StrengthHour, cfg: StrengthsConfig): StrengthScores {
  const costs = Math.max(1, h.revenueCents - h.profitCents);
  return {
    awareness: clamp(100 * h.awareness, 0, 100),
    quality: clamp(100 * h.quality, 0, 100),
    // can the company deliver what is asked? (no demand: nothing to judge, half marks)
    delivery: h.demandCents > 0 ? clamp((100 * h.capacityCents) / h.demandCents, 0, 100) : 50,
    margin: h.revenueCents > 0 ? clamp((100 * h.profitCents) / h.revenueCents / cfg.marginFull, 0, 100) : 0,
    team: clamp(h.payFactorBps / 100, 0, 100),
    finance: h.unpaidCents > 0 ? 0 : clamp((100 * h.cashCents) / (costs * cfg.cashHoursFull), 0, 100),
  };
}

/** One hour: every score moves a step toward the hour's value. */
export function strengthsStep(prev: StrengthScores, instant: StrengthScores, cfg: StrengthsConfig): StrengthScores {
  const out = {} as Record<StrengthKey, number>;
  for (const k of STRENGTH_KEYS) {
    const p = prev[k] ?? 0;
    const v = instant[k];
    const rate = k === "awareness" ? cfg.awarenessFollowPerHour : v > p ? cfg.gainPerHour : cfg.decayPerHour;
    out[k] = clamp(p + rate * (v - p), 0, 100);
  }
  return out;
}

/** Mean of the six scores (0..100). */
export function strengthsOverall(scores: StrengthScores): number {
  return STRENGTH_KEYS.reduce((s, k) => s + (scores[k] ?? 0), 0) / STRENGTH_KEYS.length;
}

/** Bonus on the hour's revenue in bps: the highest tier whose threshold the floor of the mean reaches. */
export function strengthsRewardBps(scores: StrengthScores, cfg: StrengthsConfig): number {
  const overall = Math.floor(strengthsOverall(scores));
  let bps = 0;
  for (const r of cfg.rewards) if (overall >= r.at && r.bps > bps) bps = r.bps;
  return bps;
}

/** The next tier above the current one, or null at the top. */
export function strengthsNextReward(scores: StrengthScores, cfg: StrengthsConfig): { at: number; bps: number } | null {
  const overall = Math.floor(strengthsOverall(scores));
  return [...cfg.rewards].sort((a, b) => a.at - b.at).find((r) => r.at > overall) ?? null;
}

/** The bonus of an hour in cents (rounded down). */
export function strengthsBonusCents(revenueCents: number, rewardBps: number): number {
  return Math.floor((Math.max(0, revenueCents) * rewardBps) / 10_000);
}

/**
 * Pay factor for company mini-games and other rewards that should grow with a strong company: 1 + the reward bps
 * (1.0 to 1.15 with the default tiers). Other features multiply their pay with it.
 */
export function companyHealthPayFactor(
  scores: StrengthScores,
  cfg: StrengthsConfig = BALANCE.companyHealth.strengths,
): number {
  return 1 + strengthsRewardBps(scores, cfg) / 10_000;
}
