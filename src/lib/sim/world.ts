/**
 * Weltkarte und Standorte (ADR-208): country terms of the hourly close, prices of headquarters, subsidiaries,
 * relocation and image campaigns, the location fee of the market leader and the balance score of the countries.
 * Mirrored 1:1 in SQL (world_hour_effect, world_hour_costs and the RPCs; migration 20261204010010). Pure: no clock, no
 * randomness; hours and values are passed in.
 *
 *   country demand   demandPotential × (1 + (image − 1) × imageDemandWeight)       image = baseline + campaign bonus
 *   country goods    productionCost
 *   country fixed    labourCost
 *   subsidiary i     share_i = revenueShare × diminishing^i × ramp_i   (i = 0 for the oldest), ramp = hours / rampUpHours
 *   blended factor   (1 − Σ share) × HQ + Σ share_i × country_i
 *   demand factor    blended demand × (1 + HQ tier demand) × (1 + Σ demandBonus × diminishing^i × ramp_i), clamped
 *   tax rate         blended taxRate, − taxDiscount for the market leader
 */
import type { CountryConfig, HqTierConfig, WorldConfig } from "../../config/countries.ts";
import { COUNTRIES, WORLD_RULES } from "../../config/countries.ts";

const BPS = 10_000;

export function country(key: string | null | undefined): CountryConfig | undefined {
  return key ? COUNTRIES.find((c) => c.key === key) : undefined;
}

export function hqTier(tier: number, cfg: WorldConfig = WORLD_RULES): HqTierConfig | undefined {
  return cfg.hqTiers.find((t) => t.tier === tier);
}

/**
 * Balance score of a country: every advantage weighted by its effect on the hourly result, minus the risks. Every
 * country lies within balance.tolerance of the mean (world.test.ts).
 */
export function countryScore(c: CountryConfig, w: WorldConfig["balance"] = WORLD_RULES.balance): number {
  return (
    w.production * (BPS - c.productionCostBps) +
    w.labour * (BPS - c.labourCostBps) +
    w.demand * (c.demandPotentialBps - BPS) +
    w.image * (c.imageBps - BPS) +
    w.tax * (w.taxBaselineBps - c.taxRateBps) -
    w.political * c.politicalRisk -
    w.tariff * c.tariffExposure -
    w.war * c.warRisk -
    w.disaster * c.disasterRisk.length
  );
}

export interface CountryFactors {
  demand: number;
  cogs: number;
  fixed: number;
  taxRateBps: number;
}

/** The terms of one country for a company with this image bonus there. */
export function countryFactors(c: CountryConfig, imageBonusBps = 0, cfg: WorldConfig = WORLD_RULES): CountryFactors {
  const image = c.imageBps + Math.max(0, imageBonusBps);
  return {
    demand: (c.demandPotentialBps / BPS) * (1 + ((image - BPS) * cfg.effects.imageDemandWeightBps) / (BPS * BPS)),
    cogs: c.productionCostBps / BPS,
    fixed: c.labourCostBps / BPS,
    taxRateBps: c.taxRateBps,
  };
}

/** 0..1: how far a subsidiary is ramped up after this many hours. */
export function subsidiaryRamp(hoursOpen: number, cfg: WorldConfig = WORLD_RULES): number {
  const ramp = cfg.subsidiaries.rampUpHours;
  if (ramp <= 0) return 1;
  return Math.min(1, Math.max(0, hoursOpen) / ramp);
}

/** Share (0..1) of the revenue the i-th subsidiary (0 = oldest) makes at its country's terms. */
export function subsidiaryShare(index: number, hoursOpen: number, cfg: WorldConfig = WORLD_RULES): number {
  const s = cfg.subsidiaries;
  return (s.revenueShareBps / BPS) * (s.diminishingBps / BPS) ** index * subsidiaryRamp(hoursOpen, cfg);
}

/** Extra demand (0..) of the new market of the i-th subsidiary. */
export function subsidiaryDemandBonus(index: number, hoursOpen: number, cfg: WorldConfig = WORLD_RULES): number {
  const s = cfg.subsidiaries;
  return (s.demandBonusBps / BPS) * (s.diminishingBps / BPS) ** index * subsidiaryRamp(hoursOpen, cfg);
}

/** Running costs of one subsidiary for one hour: × rampUpCostMultiplier at the start, × 1 when ramped up. */
export function subsidiaryHourlyCostCents(hoursOpen: number, cfg: WorldConfig = WORLD_RULES): number {
  const s = cfg.subsidiaries;
  const r = subsidiaryRamp(hoursOpen, cfg);
  return Math.round(s.hourlyCostCents * (s.rampUpCostMultiplier - (s.rampUpCostMultiplier - 1) * r));
}

/** Setup price of the n-th subsidiary (1 = first). */
export function subsidiarySetupCostCents(n: number, cfg: WorldConfig = WORLD_RULES): number {
  const s = cfg.subsidiaries;
  return Math.floor(s.setupCostCents * (s.setupGrowthBps / BPS) ** Math.max(0, n - 1));
}

export function relocationCostCents(investedCents: number, cfg: WorldConfig = WORLD_RULES): number {
  const r = cfg.relocation;
  return Math.max(r.minCostCents, Math.floor((investedCents * r.costBpsOfInvested) / BPS));
}

export function imageCampaignCostCents(worthCents: number, cfg: WorldConfig = WORLD_RULES): number {
  const c = cfg.imageCampaign;
  return Math.max(c.minCostCents, Math.floor((Math.max(0, worthCents) * c.costBpsOfWorth) / BPS));
}

/** The image bonus after `days` without a campaign. */
export function imageBonusAfter(bonusBps: number, days: number, cfg: WorldConfig = WORLD_RULES): number {
  return Math.max(0, Math.round(bonusBps - cfg.imageCampaign.decayPerDayBps * Math.max(0, days)));
}

/** The image bonus right after one more campaign. */
export function imageBonusWithCampaign(bonusBps: number, cfg: WorldConfig = WORLD_RULES): number {
  return Math.min(cfg.imageCampaign.maxBonusBps, Math.max(0, bonusBps) + cfg.imageCampaign.gainBps);
}

/** Location fee of one hour: a bounded share of the revenue, never more than the free cash. */
export function locationFeeCents(
  revenueCents: number,
  feeBps: number,
  freeCashCents: number,
  cfg: WorldConfig = WORLD_RULES,
): number {
  const bps = Math.min(cfg.lobby.maxFeeBps, Math.max(0, Math.floor(feeBps)));
  return Math.max(0, Math.min(Math.floor((Math.max(0, revenueCents) * bps) / BPS), Math.max(0, freeCashCents)));
}

export interface WorldPlace {
  country: string;
  imageBonusBps: number;
}

export interface WorldSubsidiary extends WorldPlace {
  hoursOpen: number;
}

export interface WorldHourEffect {
  demandFactor: number;
  cogsFactor: number;
  fixedFactor: number;
  taxRateBps: number;
  /** Σ share of the subsidiaries (0..1). */
  subsidiaryShare: number;
}

export const NEUTRAL_WORLD_EFFECT: WorldHourEffect = {
  demandFactor: 1,
  cogsFactor: 1,
  fixedFactor: 1,
  taxRateBps: 0,
  subsidiaryShare: 0,
};

const clampFactor = (v: number, cfg: WorldConfig) =>
  Math.min(cfg.effects.maxFactorBps / BPS, Math.max(cfg.effects.minFactorBps / BPS, v));

/**
 * The terms of the hour for a placed company: headquarters country, tier and the subsidiaries (oldest first).
 * Neutral when not placed.
 */
export function worldHourEffect(
  hq: (WorldPlace & { tier: number; leader?: boolean }) | null,
  subsidiaries: readonly WorldSubsidiary[] = [],
  cfg: WorldConfig = WORLD_RULES,
  countries: readonly CountryConfig[] = COUNTRIES,
): WorldHourEffect {
  const hc = hq ? countries.find((c) => c.key === hq.country) : undefined;
  if (!hq || !hc) return NEUTRAL_WORLD_EFFECT;
  const home = countryFactors(hc, hq.imageBonusBps, cfg);
  const parts = subsidiaries.slice(0, cfg.subsidiaries.max).flatMap((s, i) => {
    const sc = countries.find((c) => c.key === s.country);
    if (!sc) return [];
    return [
      {
        share: subsidiaryShare(i, s.hoursOpen, cfg),
        bonus: subsidiaryDemandBonus(i, s.hoursOpen, cfg),
        f: countryFactors(sc, s.imageBonusBps, cfg),
      },
    ];
  });
  const total = Math.min(0.9, parts.reduce((a, p) => a + p.share, 0));
  const blend = (pick: (f: CountryFactors) => number) =>
    (1 - total) * pick(home) + parts.reduce((a, p) => a + p.share * pick(p.f), 0);
  const tierDemand = (hqTier(hq.tier, cfg)?.demandBps ?? 0) / BPS;
  const marketBonus = parts.reduce((a, p) => a + p.bonus, 0);
  const tax = Math.round(blend((f) => f.taxRateBps));
  return {
    demandFactor: clampFactor(blend((f) => f.demand) * (1 + tierDemand) * (1 + marketBonus), cfg),
    cogsFactor: clampFactor(blend((f) => f.cogs), cfg),
    fixedFactor: clampFactor(blend((f) => f.fixed), cfg),
    taxRateBps: hq.leader ? Math.round((tax * (BPS - cfg.lobby.taxDiscountBps)) / BPS) : tax,
    subsidiaryShare: total,
  };
}

/** Whether a company may open a subsidiary: value or headquarters tier, and below the cap. */
export function subsidiaryUnlocked(worthCents: number, hqTierNow: number, cfg: WorldConfig = WORLD_RULES): boolean {
  return hqTierNow > 0 && (worthCents >= cfg.subsidiaries.unlockWorthCents || hqTierNow >= cfg.subsidiaries.unlockHqTier);
}

/** Progress (0..1) toward the world map. */
export function worldUnlockProgress(worthCents: number, cfg: WorldConfig = WORLD_RULES): number {
  return Math.min(1, Math.max(0, worthCents) / cfg.unlockWorthCents);
}
