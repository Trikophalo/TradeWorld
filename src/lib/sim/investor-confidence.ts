/**
 * Investor confidence (ADR-216): formulas for the confidence of the AI investors in a stock (0..100), the market mood
 * and the AI order flow that follows the confidence. Mirrored in Postgres
 * (supabase/migrations/20261204011100_investor_confidence.sql). Pure: randomness and time are passed in.
 */
import { INVESTOR_CONFIDENCE } from "../../config/investor-confidence.ts";
import type { ConfidenceEventKey, InvestorConfidenceConfig, MoodPhase } from "../../config/investor-confidence.ts";

export type ConfidenceFactors = Partial<Record<string, number>>;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// ------------------------------------------------------------------------------------------------ AI order flow

/**
 * Signal of the confidence investors in [-1, 1]: gain × (C − 50) / 50, more selling below panicBelow (panic) and more
 * buying above 100 − panicBelow (euphoria). Symmetric around 50, so a neutral market has no drift.
 */
export function confidenceSignal(
  confidence: number,
  cfg: InvestorConfidenceConfig["flow"] = INVESTOR_CONFIDENCE.flow,
): number {
  const c = clamp(confidence, 0, 100);
  const base = (cfg.gain * (c - 50)) / 50;
  const panic = c < cfg.panicBelow ? (-cfg.panicGain * (cfg.panicBelow - c)) / cfg.panicBelow : 0;
  const euphoria = c > 100 - cfg.panicBelow ? (cfg.panicGain * (c - (100 - cfg.panicBelow))) / cfg.panicBelow : 0;
  return clamp(base + panic + euphoria, -1, 1);
}

/** Net shares the confidence investors buy (positive) or sell in one tick. */
export function confidencePressure(
  confidence: number,
  freeFloatShares: number,
  liquidityFactor = 1,
  cfg: InvestorConfidenceConfig["flow"] = INVESTOR_CONFIDENCE.flow,
): number {
  return freeFloatShares * cfg.capitalShare * cfg.reactionSpeed * liquidityFactor * confidenceSignal(confidence, cfg);
}

// --------------------------------------------------------------------------------------------- event factors

/** A bump fades with its half-life: value × 0,5^(hours / halfLife). */
export function decayFactor(value: number, hours: number, halfLifeHours: number): number {
  if (halfLifeHours <= 0) return 0;
  return value * Math.pow(0.5, Math.max(0, hours) / halfLifeHours);
}

/** Adds a bump to an event factor, capped at ±max of its key. */
export function addBump(
  factors: ConfidenceFactors,
  key: ConfidenceEventKey,
  delta: number,
  cfg: InvestorConfidenceConfig = INVESTOR_CONFIDENCE,
): ConfidenceFactors {
  const max = cfg.events[key].max;
  return { ...factors, [key]: clamp((factors[key] ?? 0) + delta, -max, max) };
}

/** Lets every event factor fade for `minutes`. */
export function decayEvents(
  factors: ConfidenceFactors,
  minutes: number,
  cfg: InvestorConfidenceConfig = INVESTOR_CONFIDENCE,
): ConfidenceFactors {
  const out: ConfidenceFactors = { ...factors };
  for (const key of Object.keys(cfg.events) as ConfidenceEventKey[]) {
    const v = out[key];
    if (v === undefined) continue;
    const next = decayFactor(v, minutes / 60, cfg.events[key].halfLifeHours);
    if (Math.abs(next) < 0.05) delete out[key];
    else out[key] = next;
  }
  return out;
}

/** Earnings: surprise in [-1, 1] (net income against expectation). */
export function earningsBump(surprise: number, cfg = INVESTOR_CONFIDENCE.events.earnings): number {
  return cfg.perSurprise * clamp(surprise, -1, 1);
}

/** Stock news or a market force that came true: points per 10 % move (1.000 bps), signed. */
export function moveBump(signedMoveBps: number, pointsPerTenPercent: number): number {
  return (signedMoveBps / 1_000) * pointsPerTenPercent;
}

/** Dividend: yield of the payout against the market cap, at least `min`. */
export function payoutBump(
  totalCents: number,
  marketCapCents: number,
  cfg = INVESTOR_CONFIDENCE.events.payout,
): number {
  if (totalCents <= 0) return 0;
  const yieldBps = marketCapCents > 0 ? (totalCents * 10_000) / marketCapCents : 0;
  return Math.max(cfg.min, Math.min(cfg.max, (yieldBps / 100) * cfg.pointsPerPercentYield));
}

/** Founder takes money out of the company: share of the cash (before) withdrawn. */
export function withdrawBump(
  amountCents: number,
  cashBeforeCents: number,
  cfg = INVESTOR_CONFIDENCE.events.withdraw,
): number {
  if (amountCents <= 0) return 0;
  const share = cashBeforeCents > 0 ? clamp(amountCents / cashBeforeCents, 0, 1) : 1;
  return -Math.max(cfg.min, Math.min(cfg.max, cfg.perCashShare * share));
}

/** Founder sells own shares: share of the founder's stake sold. */
export function insiderBump(
  soldShares: number,
  stakeBeforeShares: number,
  cfg = INVESTOR_CONFIDENCE.events.insider,
): number {
  if (soldShares <= 0) return 0;
  const share = stakeBeforeShares > 0 ? clamp(soldShares / stakeBeforeShares, 0, 1) : 1;
  return -Math.min(cfg.max, cfg.base + cfg.perStakeShare * share);
}

/** Capital increase: new shares relative to the old count. */
export function dilutionBump(oldShares: number, newShares: number, cfg = INVESTOR_CONFIDENCE.events.dilution): number {
  if (oldShares <= 0 || newShares <= oldShares) return 0;
  return -Math.min(cfg.max, cfg.perNewShare * (newShares / oldShares - 1));
}

/** A crisis or chance starts (crisis negative); scandals and external events weigh more. */
export function crisisStartBump(
  archetype: string,
  polarity: "crisis" | "chance",
  severity: number,
  cfg: InvestorConfidenceConfig = INVESTOR_CONFIDENCE,
): { key: "event" | "scandal"; delta: number } {
  const scandal = (cfg.scandalArchetypes as readonly string[]).includes(archetype);
  const external = (cfg.externalArchetypes as readonly string[]).includes(archetype);
  if (polarity === "chance") return { key: "event", delta: cfg.events.event.solvedPerSeverity * severity };
  if (scandal) return { key: "scandal", delta: -cfg.events.scandal.perSeverity * severity };
  return { key: "event", delta: -cfg.events.event.perSeverity * severity * (external ? cfg.externalWeight : 1) };
}

// -------------------------------------------------------------------------------------------- stock incidents

/**
 * Chance per hour of a stock incident for a listed player company: min(max, base + perHeat × heat) × (1 +
 * perWorthDecade × log10(market cap / 1 Mio. €), from 1 Mio. €).
 */
export function incidentChancePerHour(
  heat: number,
  marketCapCents: number,
  cfg: InvestorConfidenceConfig["incidents"] = INVESTOR_CONFIDENCE.incidents,
): number {
  const size = 1 + cfg.perWorthDecade * Math.max(0, Math.log10(Math.max(1, marketCapCents) / 100_000_000));
  return Math.min(cfg.maxPerHour, cfg.basePerHour + cfg.perHeatPerHour * Math.max(0, heat)) * size;
}

/** Severity 1..3 from the heat of the stock. */
export function incidentSeverity(
  heat: number,
  cfg: InvestorConfidenceConfig["incidents"] = INVESTOR_CONFIDENCE.incidents,
): 1 | 2 | 3 {
  return heat >= cfg.severity3Heat ? 3 : heat >= cfg.severity2Heat ? 2 : 1;
}

/** Bumps of the "incident" factor: start, step done or failed, bad strategy chosen, solved, deadline lost. */
export function incidentBump(
  kind: "start" | "stepSucceeded" | "stepFailed" | "badStrategy" | "solved" | "lost",
  severity: number,
  cfg: InvestorConfidenceConfig["events"]["incident"] = INVESTOR_CONFIDENCE.events.incident,
): number {
  switch (kind) {
    case "start":
      return -cfg.perSeverity * severity;
    case "stepSucceeded":
      return cfg.stepSucceededPerSeverity * severity;
    case "stepFailed":
      return -cfg.stepFailedPerSeverity * severity;
    case "badStrategy":
      return -cfg.badStrategyPerSeverity * severity;
    case "solved":
      return cfg.solvedPerSeverity * severity;
    case "lost":
      return -cfg.lostPerSeverity * severity;
  }
}

// ---------------------------------------------------------------------------------------------- state factors

export interface ConfidenceStateInputs {
  /** Profit of the recent and the prior period (cents); null without history. */
  readonly profitRecentCents: number | null;
  readonly profitPriorCents: number | null;
  /** Reputation 0..100 (player companies), null = none. */
  readonly reputation: number | null;
  /** Severity of an active crisis, 0 = none. */
  readonly crisisSeverity: number;
  /** Severity of an open stock incident, 0 = none. */
  readonly incidentSeverity?: number;
  /** (political + war risk) / 2 of the headquarters' country, 0..100; null = none. */
  readonly countryRisk: number | null;
  /** Σ (tier + 1) of hired talents, and whether one is co-CEO. */
  readonly talentTiers: number;
  readonly coCeo: boolean;
  /** σ of the hourly log returns over 24 h; null without history. */
  readonly volatility: number | null;
  /** Market mood 0..100 and the tilt of the stock's sector (points). */
  readonly mood: number;
  readonly sectorTilt: number;
  /** ln(price / price 24 h ago); null without history. */
  readonly logReturn24h: number | null;
  /** ln(price / fair value). */
  readonly logPremium: number;
  /** Chatter (random walk of rumours). */
  readonly chatter: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** The state factors (points); zero factors are left out. */
export function stateFactors(
  s: ConfidenceStateInputs,
  cfg: InvestorConfidenceConfig["state"] = INVESTOR_CONFIDENCE.state,
): ConfidenceFactors {
  const f: ConfidenceFactors = {};
  if (s.profitRecentCents !== null && s.profitPriorCents !== null) {
    const base = Math.max(Math.abs(s.profitPriorCents), 100);
    f.profit =
      cfg.profitMax * Math.tanh((s.profitRecentCents - s.profitPriorCents) / base) +
      (s.profitRecentCents < 0 ? cfg.lossPoints : 0);
  }
  if (s.reputation !== null) f.reputation = (s.reputation - 50) * cfg.reputationPerPoint;
  if (s.crisisSeverity > 0) f.crisis = cfg.crisisPerSeverity * s.crisisSeverity;
  if ((s.incidentSeverity ?? 0) > 0) f.incident_open = cfg.incidentPerSeverity * s.incidentSeverity!;
  if (s.countryRisk !== null) f.country = -cfg.countryPerRisk * s.countryRisk;
  if (s.talentTiers > 0 || s.coCeo)
    f.management = Math.min(
      cfg.managementMax,
      cfg.managementPerTier * s.talentTiers + (s.coCeo ? cfg.managementCoCeo : 0),
    );
  if (s.volatility !== null)
    f.volatility = -Math.min(
      cfg.volatilityMax,
      cfg.volatilityPerSigma * Math.max(0, s.volatility - cfg.volatilityFree),
    );
  f.macro = (s.mood - 50) * cfg.macroPerPoint;
  if (s.sectorTilt !== 0) f.sector = s.sectorTilt;
  if (s.logReturn24h !== null) f.momentum = cfg.momentumMax * Math.tanh(s.logReturn24h / cfg.momentumScale);
  f.valuation = -cfg.valuationMax * Math.tanh(s.logPremium / cfg.valuationScale);
  f.chatter = s.chatter;
  for (const k of Object.keys(f)) {
    const v = round1(f[k]!);
    if (v === 0) delete f[k];
    else f[k] = v;
  }
  return f;
}

/** One minute of chatter: x × (1 − 1 / τ) + σ × z (z standard normal). */
export function stepChatter(
  x: number,
  z: number,
  cfg: InvestorConfidenceConfig["state"] = INVESTOR_CONFIDENCE.state,
): number {
  return x * (1 - 1 / (cfg.chatterTauHours * 60)) + cfg.chatterSigma * z;
}

/** Target 50 + Σ factors, clamped to 0..100. */
export function confidenceTarget(factors: ConfidenceFactors): number {
  let sum = 50;
  for (const v of Object.values(factors)) sum += v ?? 0;
  return clamp(sum, 0, 100);
}

/** One minute towards the target. */
export function stepConfidence(
  current: number,
  target: number,
  cfg: InvestorConfidenceConfig = INVESTOR_CONFIDENCE,
): number {
  return clamp(current + (target - current) * cfg.smoothingPerMinute, 0, 100);
}

/** σ of consecutive log returns (hourly closes, oldest first); null with fewer than 4 prices. */
export function volatilityOf(prices: readonly number[]): number | null {
  if (prices.length < 4) return null;
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++)
    if (prices[i - 1]! > 0 && prices[i]! > 0) r.push(Math.log(prices[i]! / prices[i - 1]!));
  if (r.length < 3) return null;
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1));
}

/** The top reasons: |value| ≥ minPoints, strongest first, at most maxReasons. */
export function topReasons(
  factors: ConfidenceFactors,
  cfg: InvestorConfidenceConfig["reasons"] = INVESTOR_CONFIDENCE.reasons,
): { key: string; points: number }[] {
  return Object.entries(factors)
    .filter((e): e is [string, number] => e[1] !== undefined && Math.abs(e[1]) >= cfg.minPoints)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0]))
    .slice(0, cfg.maxReasons)
    .map(([key, points]) => ({ key, points: round1(points) }));
}

// ------------------------------------------------------------------------------------------------ market mood

export interface MoodState {
  readonly mood: number;
  readonly phase: MoodPhase;
  /** Minutes left in the phase. */
  readonly phaseMinutesLeft: number;
}

/** Draws the next phase from the weights (u uniform in [0, 1)). */
export function pickPhase(u: number, cfg: InvestorConfidenceConfig["mood"] = INVESTOR_CONFIDENCE.mood): MoodPhase {
  const phases = Object.entries(cfg.phases) as [MoodPhase, { weight: number }][];
  const total = phases.reduce((a, [, p]) => a + p.weight, 0);
  let x = u * total;
  for (const [key, p] of phases) {
    x -= p.weight;
    if (x < 0) return key;
  }
  return phases[phases.length - 1]![0];
}

/** Length of a phase in minutes (u uniform in [0, 1)). */
export function phaseMinutes(
  phase: MoodPhase,
  u: number,
  cfg: InvestorConfidenceConfig["mood"] = INVESTOR_CONFIDENCE.mood,
): number {
  const p = cfg.phases[phase];
  return Math.round((p.minHours + u * (p.maxHours - p.minHours)) * 60);
}

/** One minute of market mood: towards the phase target with noise z; a new phase when the old one ends. */
export function stepMood(
  s: MoodState,
  z: number,
  uPhase: number,
  uLength: number,
  cfg: InvestorConfidenceConfig["mood"] = INVESTOR_CONFIDENCE.mood,
): MoodState {
  let phase = s.phase;
  let left = s.phaseMinutesLeft - 1;
  if (left <= 0) {
    phase = pickPhase(uPhase, cfg);
    left = phaseMinutes(phase, uLength, cfg);
  }
  const target = cfg.phases[phase].target;
  const mood = clamp(s.mood + (target - s.mood) / (cfg.tauHours * 60) + cfg.sigmaPerMinute * z, 0, 100);
  return { mood, phase, phaseMinutesLeft: left };
}

/** Growth of an AI company's business per game year: sector × trendShare + cycle × (mood − 50) / 50. */
export function aiGrowthPerGameYear(
  sectorGrowthBps: number,
  mood: number,
  cfg: InvestorConfidenceConfig["aiFundamentals"] = INVESTOR_CONFIDENCE.aiFundamentals,
): number {
  return (sectorGrowthBps / 10_000) * cfg.trendShare + (cfg.cycleGrowthPerGameYear * (mood - 50)) / 50;
}

/** Market mood label: the phase name for the badge. */
export function moodLabel(mood: number): "panic" | "fear" | "neutral" | "optimism" | "euphoria" {
  if (mood < 20) return "panic";
  if (mood < 40) return "fear";
  if (mood <= 60) return "neutral";
  if (mood <= 80) return "optimism";
  return "euphoria";
}
