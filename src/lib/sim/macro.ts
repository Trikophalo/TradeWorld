/**
 * Size, risk and the world outside (ADR-209): market saturation and overhead of big companies, how the size moves the
 * daily event roll, country risk, insurance and lobby. Pure functions; Postgres mirrors them
 * (supabase/migrations/20261204010100_macro_events.sql).
 */
import { MACRO } from "../../config/macro.ts";
import type { MacroConfig } from "../../config/macro.ts";
import type { CompanyEventArchetype } from "../../config/company-events.ts";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// ------------------------------------------------------------------ friction of the hour

/**
 * Demand factor from market saturation by company value: 1 up to the pivot, above it (pivot / value)^(1 − exponent).
 */
export function saturationFactor(worthCents: number, cfg: MacroConfig = MACRO): number {
  const { worthPivotCents: pivot, saturationExponent: e } = cfg.friction;
  if (!(worthCents > pivot)) return 1;
  return Math.pow(pivot / worthCents, 1 - e);
}

/** Overhead (bureaucracy) as a share of the revenue: perDecade × log10(value / pivot), capped; 0 up to the pivot. */
export function overheadShare(worthCents: number, cfg: MacroConfig = MACRO): number {
  const { worthPivotCents: pivot, overheadPerDecadeBps, overheadMaxBps } = cfg.friction;
  if (!(worthCents > pivot)) return 0;
  return Math.min(overheadMaxBps, overheadPerDecadeBps * Math.log10(worthCents / pivot)) / 10_000;
}

/** Insurance level 0..n: coverage of insurable damage and premium as a share of the own revenue. */
export function insuranceLevel(level: number, cfg: MacroConfig = MACRO) {
  const levels = cfg.insurance.levels;
  return levels[clamp(Math.floor(level), 0, levels.length - 1)]!;
}

export interface FrictionModifiers {
  readonly demandFactor: number;
  /** Extra costs as a share of the own revenue (overhead and insurance premium). */
  readonly extraCostShare: number;
}

/** What size and insurance do to an hour (on top of a running event's modifiers). */
export function frictionModifiers(worthCents: number, insurance: number, cfg: MacroConfig = MACRO): FrictionModifiers {
  return {
    demandFactor: saturationFactor(worthCents, cfg),
    extraCostShare: overheadShare(worthCents, cfg) + insuranceLevel(insurance, cfg).premiumBps / 10_000,
  };
}

/** A running event's modifiers and the friction together, extra costs capped (never bankrupt outright). */
export function combineModifiers(
  event: { demandFactor: number; capacityFactor: number; extraCostShare: number },
  friction: FrictionModifiers,
  cfg: MacroConfig = MACRO,
): { demandFactor: number; capacityFactor: number; extraCostShare: number } {
  return {
    demandFactor: event.demandFactor * friction.demandFactor,
    capacityFactor: event.capacityFactor,
    extraCostShare: Math.min(cfg.maxExtraCostShare, event.extraCostShare + friction.extraCostShare),
  };
}

// ------------------------------------------------------------------ the daily roll

/** How many tenfolds the company value lies above the pivot, 0..maxDecades. */
export function sizeDecades(worthCents: number, cfg: MacroConfig = MACRO): number {
  const pivot = cfg.events.worthPivotCents;
  if (!(worthCents > pivot)) return 0;
  return Math.min(cfg.events.maxDecades, Math.log10(worthCents / pivot));
}

/** Daily chance of an event for a company of this size. */
export function sizedChancePerDay(base: number, decades: number, cfg: MacroConfig = MACRO): number {
  if (decades <= 0) return base;
  return Math.max(base, Math.min(cfg.events.maxChancePerDay, base + cfg.events.chancePerDayPerDecade * decades));
}

/** Share of chances among the events: falls with the size, never below minChanceShare. */
export function sizedChanceShare(base: number, decades: number, cfg: MacroConfig = MACRO): number {
  if (decades <= 0) return base;
  return Math.min(base, Math.max(cfg.events.minChanceShare, base - cfg.events.chanceShareCutPerDecade * decades));
}

/** Pushes the severity draw upwards for big companies: u → 1 − (1 − u)^(1 + power × decades). */
export function sizedSeverityUniform(u: number, decades: number, cfg: MacroConfig = MACRO): number {
  if (decades <= 0) return u;
  return 1 - Math.pow(1 - clamp(u, 0, 1), 1 + cfg.events.severityPowerPerDecade * decades);
}

/** Country risk of the headquarters (country_cfg, ADR-208); null = no headquarters, neutral. */
export interface CountryRisk {
  readonly politicalRisk?: number;
  readonly tariffExposure?: number;
  readonly warRisk?: number;
  readonly imageBps?: number;
  readonly disasterRisk?: readonly (string | { readonly kind?: string; readonly key?: string })[];
}

/** A risk of country_cfg (0..100) as 0..1. */
export function riskShare(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return 0;
  return clamp(v / 100, 0, 1);
}

function disasterKinds(country: CountryRisk, cfg: MacroConfig): string[] {
  return (country.disasterRisk ?? [])
    .map((d) => (typeof d === "string" ? d : (d.kind ?? d.key ?? "")))
    .flatMap((d) => cfg.country.disasterMap[d] ?? [d])
    .filter((d) => d.length > 0);
}

/** Factor of the country on an archetype's weight. */
export function countryFactor(
  archetype: CompanyEventArchetype,
  country: CountryRisk | null,
  cfg: MacroConfig = MACRO,
): number {
  if (!country || !archetype.risk) return 1;
  const c = cfg.country;
  switch (archetype.risk) {
    case "political":
      return 1 + c.politicalBoost * riskShare(country.politicalRisk);
    case "tariff":
      return 1 + c.tariffBoost * riskShare(country.tariffExposure);
    case "war":
      return 1 + c.warBoost * riskShare(country.warRisk);
    case "image":
      // a bad image (negative imageBps) makes shitstorms likelier
      return 1 + c.imageBoost * clamp(-(country.imageBps ?? 0) / 10_000, 0, 1);
    case "disaster": {
      const kinds = disasterKinds(country, cfg);
      if (kinds.length === 0) return 1;
      return kinds.includes(archetype.key) ? c.disasterListed : c.disasterOther;
    }
  }
}

export interface SizeContext {
  readonly worthCents: number;
  readonly country?: CountryRisk | null;
  readonly lobbyLevel?: number;
}

/**
 * Weight of an archetype for a company of this size: internal archetypes unchanged, external ones only from their
 * minimum value, × (1 + boost × decades) × country × (1 − lobby cut) for political ones.
 */
export function sizedWeight(archetype: CompanyEventArchetype, size: SizeContext | undefined, cfg: MacroConfig = MACRO) {
  if (!archetype.external) return archetype.weight;
  if (!size || size.worthCents < (archetype.minWorthCents ?? 0)) return 0;
  const decades = sizeDecades(size.worthCents, cfg);
  const lobby = archetype.risk === "political" ? lobbyPoliticalFactor(size.lobbyLevel ?? 0, cfg) : 1;
  return (
    archetype.weight *
    (1 + cfg.events.externalBoostPerDecade * decades) *
    countryFactor(archetype, size.country ?? null, cfg) *
    lobby
  );
}

// ------------------------------------------------------------------ cost unit, insurance, lobby

/** One cost unit of a response step: never below this share of the company value. */
export function worthUnitCents(worthCents: number, cfg: MacroConfig = MACRO): number {
  return Math.round((Math.max(0, worthCents) * cfg.events.unitWorthBps) / 10_000);
}

/**
 * Coverage when an event starts: the current level once it is older than changeWaitHours, until then the lower of
 * the old and the new level (no buying after the quake).
 */
export function effectiveCoverage(
  level: number,
  previousLevel: number,
  hoursSinceChange: number | null,
  cfg: MacroConfig = MACRO,
): number {
  const settled = hoursSinceChange === null || hoursSinceChange >= cfg.insurance.changeWaitHours;
  const lvl = settled ? level : Math.min(level, previousLevel);
  return insuranceLevel(lvl, cfg).coverage;
}

/** Bonus on the base chance of lobby steps. */
export function lobbyBonusBps(level: number, cfg: MacroConfig = MACRO): number {
  return clamp(Math.floor(level), 0, cfg.lobby.maxLevel) * cfg.lobby.successBpsPerLevel;
}

export function lobbyPoliticalFactor(level: number, cfg: MacroConfig = MACRO): number {
  return Math.max(0, 1 - clamp(Math.floor(level), 0, cfg.lobby.maxLevel) * cfg.lobby.politicalCutPerLevel);
}

/** Whether a strategy is lobby work (its win raises the lobby level, its steps get the lobby bonus). */
export const isLobbyStrategy = (key: string) => key.startsWith("lobby");

/**
 * The archetype as it is stored for one event: insurance coverage for insurable ones, the lobby bonus on the base
 * chance of lobby steps (at most 9 500).
 */
export function eventSnapshot(
  archetype: CompanyEventArchetype,
  coverage: number,
  lobbyLevel: number,
  cfg: MacroConfig = MACRO,
  /** World map (ADR-208): market leader of its country, political events hit it less (world.lobby). */
  leaderReductionBps = 0,
): CompanyEventArchetype {
  const bonus = lobbyBonusBps(lobbyLevel, cfg);
  return {
    ...archetype,
    ...(archetype.insurable ? { insuredShare: clamp(coverage, 0, 1) } : {}),
    ...(archetype.risk === "political" && leaderReductionBps > 0
      ? { leaderShare: clamp(leaderReductionBps / 10_000, 0, 1) }
      : {}),
    strategies: archetype.strategies.map((s) =>
      isLobbyStrategy(s.key) && bonus > 0
        ? {
            ...s,
            steps: s.steps.map((st) => ({ ...st, baseBps: Math.max(st.baseBps, Math.min(9_500, st.baseBps + bonus)) })),
          }
        : s,
    ),
  };
}
