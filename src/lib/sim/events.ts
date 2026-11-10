/**
 * Scheduled and random events (spec 5.5). Everything here produces data
 * (effects, shocks, news items); applying them is up to the caller.
 */
import { BALANCE } from "../../config/balance.ts";
import type { EventsConfig, SectorId, SizeClass } from "../../config/balance.ts";
import type { MacroEffect, NewsItem, PharmaTrialResult, Rng } from "./types.ts";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const SECTOR_IDS: readonly SectorId[] = ["tech", "retail", "energy", "pharma", "logistics"];

/**
 * Binary pharma trial (spec 5.5): success moves the price by +50..70 %, failure
 * by -50..70 %. The same factor is applied to the company's `eventValueFactor`
 * so that the fair value follows and value funds do not revert the jump.
 */
export function resolvePharmaTrial(
  sizeClass: SizeClass,
  rng: Rng,
  cfg: EventsConfig["pharmaTrial"] = BALANCE.events.pharmaTrial,
): PharmaTrialResult {
  const success = rng.chance(cfg.successProbability[sizeClass]);
  const move = rng.range(cfg.minMove, cfg.maxMove);
  return { success, priceReturn: success ? move : -move };
}

/** Whether a new trial gets announced for a pharma company this quarter. */
export function rollPharmaTrialAnnouncement(
  rng: Rng,
  cfg: EventsConfig["pharmaTrial"] = BALANCE.events.pharmaTrial,
): boolean {
  return rng.chance(cfg.probabilityPerQuarter);
}

/** Oil report: log-normal change with mean reversion to the baseline 1. */
export function stepOilIndex(
  oilIndex: number,
  rng: Rng,
  cfg: EventsConfig["oilReport"] = BALANCE.events.oilReport,
): number {
  const reverted = oilIndex + cfg.meanReversion * (1 - oilIndex);
  return clamp(reverted * Math.exp(rng.normal(0, cfg.changeStdDev)), cfg.minIndex, cfg.maxIndex);
}

/** Business cycle: slow mean-reverting random walk around 1. */
export function stepCycleIndex(
  cycleIndex: number,
  rng: Rng,
  cfg: EventsConfig["businessCycle"] = BALANCE.events.businessCycle,
): number {
  const next = cycleIndex + cfg.meanReversion * (1 - cycleIndex) + rng.normal(0, cfg.noiseStdDev);
  return clamp(next, cfg.minIndex, cfg.maxIndex);
}

export interface MacroEventRoll {
  /** New demand effects, active from the NEXT quarter on. */
  readonly effects: readonly MacroEffect[];
  /** Multiplier on the oil index (commodity shock), 1 if none. */
  readonly oilFactor: number;
  readonly news: readonly NewsItem[];
}

/**
 * Rolls the random macro events of one quarter: sector crisis, commodity shock,
 * recession, tech boom. At most one event of each kind per quarter.
 */
export function rollMacroEvents(rng: Rng, cfg: EventsConfig["macro"] = BALANCE.events.macro): MacroEventRoll {
  const effects: MacroEffect[] = [];
  const news: NewsItem[] = [];
  let oilFactor = 1;

  if (rng.chance(cfg.sectorCrisis.probabilityPerQuarter)) {
    const sectorId = rng.pick(SECTOR_IDS);
    effects.push({
      kind: "sector_crisis",
      sectorId,
      demandFactor: 1 + cfg.sectorCrisis.magnitude,
      quartersRemaining: cfg.sectorCrisis.durationQuarters,
    });
    news.push({
      templateKey: "macro.sector_crisis",
      scope: "sector",
      sectorId,
      vars: {
        sectorId,
        demandChangePct: cfg.sectorCrisis.magnitude * 100,
        quarters: cfg.sectorCrisis.durationQuarters,
      },
      sentimentDelta: cfg.sectorCrisis.sentimentShock,
      importance: 3,
    });
  }

  if (rng.chance(cfg.commodityShock.probabilityPerQuarter)) {
    const up = rng.chance(0.5);
    oilFactor = up ? 1 + cfg.commodityShock.magnitude : 1 / (1 + cfg.commodityShock.magnitude);
    // Oil up helps energy and hurts logistics (spec 10.1); the news carries the
    // energy view, `closeQuarter` mirrors the sentiment for logistics.
    news.push({
      templateKey: up ? "macro.commodity_shock_up" : "macro.commodity_shock_down",
      scope: "sector",
      sectorId: "energy",
      vars: { oilChangePct: (oilFactor - 1) * 100 },
      sentimentDelta: up ? cfg.commodityShock.sentimentShock : -cfg.commodityShock.sentimentShock,
      importance: 3,
    });
  }

  if (rng.chance(cfg.recession.probabilityPerQuarter)) {
    effects.push({
      kind: "recession",
      sectorId: null,
      demandFactor: 1 + cfg.recession.magnitude,
      quartersRemaining: cfg.recession.durationQuarters,
    });
    news.push({
      templateKey: "macro.recession",
      scope: "market",
      vars: { demandChangePct: cfg.recession.magnitude * 100, quarters: cfg.recession.durationQuarters },
      sentimentDelta: cfg.recession.sentimentShock,
      importance: 3,
    });
  }

  if (rng.chance(cfg.techBoom.probabilityPerQuarter)) {
    effects.push({
      kind: "tech_boom",
      sectorId: "tech",
      demandFactor: 1 + cfg.techBoom.magnitude,
      quartersRemaining: cfg.techBoom.durationQuarters,
    });
    news.push({
      templateKey: "macro.tech_boom",
      scope: "sector",
      sectorId: "tech",
      vars: {
        sectorId: "tech",
        demandChangePct: cfg.techBoom.magnitude * 100,
        quarters: cfg.techBoom.durationQuarters,
      },
      sentimentDelta: cfg.techBoom.sentimentShock,
      importance: 3,
    });
  }

  return { effects, oilFactor, news };
}

/** Combined demand factor of all running effects for one sector. */
export function effectDemandFactor(effects: readonly MacroEffect[], sectorId: SectorId): number {
  let factor = 1;
  for (const effect of effects) {
    if (effect.sectorId === null || effect.sectorId === sectorId) factor *= effect.demandFactor;
  }
  return factor;
}

/** Ages the running effects by one quarter and drops the expired ones. */
export function ageEffects(effects: readonly MacroEffect[]): MacroEffect[] {
  return effects
    .map((effect) => ({ ...effect, quartersRemaining: effect.quartersRemaining - 1 }))
    .filter((effect) => effect.quartersRemaining > 0);
}

/**
 * Sentiment shock from an earnings release: relative surprise of the net income
 * against the expectation (mean of the previous quarters), scaled and clamped.
 */
export function earningsSentiment(
  netIncomeCents: bigint,
  expectedNetIncomeCents: bigint,
  revenueCents: bigint,
  cfg: EventsConfig["earnings"] = BALANCE.events.earnings,
): { readonly surprise: number; readonly sentimentDelta: number } {
  // Normalise by revenue (5 % margin as scale) so that results near zero do not explode.
  const scale = Math.max(Math.abs(Number(expectedNetIncomeCents)), Number(revenueCents) * 0.05, 1);
  const surprise = (Number(netIncomeCents) - Number(expectedNetIncomeCents)) / scale;
  const sentimentDelta = clamp(surprise * cfg.sentimentPerSurprise, -cfg.maxSentimentShock, cfg.maxSentimentShock);
  return { surprise, sentimentDelta };
}
