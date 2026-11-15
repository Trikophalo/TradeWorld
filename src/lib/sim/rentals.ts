/**
 * Wohnwert and renting out places in the own home (ADR-158). Integer arithmetic only, so the database
 * (home_wohnwert, rental_* functions in supabase/migrations/20261204003950_rentals.sql) computes the same numbers.
 */
import { BALANCE } from "../../config/balance.ts";
import type { FloorMaterial, PropertyTier, RentPeriod, RentalsConfig } from "../../config/balance.ts";
import { tierConfig } from "./property.ts";

export interface WohnwertPiece {
  /** Furniture category (seating, tables, beds ...). */
  readonly category: string;
  /** Furniture tier (budget ... ultra), the "style" of a piece. */
  readonly tier: string;
  /** Catalogue price (not the price paid: the makler discount does not change the Wohnwert). */
  readonly priceCents: number;
  readonly w: number;
  readonly h: number;
  readonly layer: "floor" | "object" | "top";
}

export interface WohnwertParts {
  readonly value: number;
  readonly variety: number;
  readonly fill: number;
  readonly layers: number;
  readonly style: number;
  readonly floor: number;
}

export interface Wohnwert {
  /** 0 to 100. */
  readonly total: number;
  readonly parts: WohnwertParts;
  readonly valueCents: number;
  readonly targetCents: number;
  readonly categories: number;
  /** Share of the floor covered by furniture of the object layer. */
  readonly coverageBps: number;
  readonly rugs: number;
  readonly tops: number;
  readonly pieces: number;
}

const cfgOf = (cfg?: RentalsConfig) => cfg ?? BALANCE.rentals;

/**
 * The Wohnwert of a furnished home: furniture value against the price of the home, variety of categories, how well
 * the floor is filled (neither empty nor crammed), rugs and small things on surfaces, one style, the floor material.
 */
export function wohnwert(
  tier: PropertyTier,
  floor: FloorMaterial,
  pieces: readonly WohnwertPiece[],
  cfg?: RentalsConfig,
): Wohnwert {
  const c = cfgOf(cfg).wohnwert;
  const P = c.points;
  const home = tierConfig(tier);
  const area = home.width * home.height;

  const valueCents = pieces.reduce((s, p) => s + p.priceCents, 0);
  const targetCents = Math.max(1, Math.floor((home.priceCents * c.valueTargetBps) / 10_000));
  const value = Math.min(P.value, Math.floor((P.value * valueCents) / targetCents));

  const categories = new Set(pieces.map((p) => p.category)).size;
  const variety = Math.floor((P.variety * Math.min(categories, c.varietyTarget)) / c.varietyTarget);

  const covered = pieces.filter((p) => p.layer === "object").reduce((s, p) => s + p.w * p.h, 0);
  const coverageBps = Math.floor((covered * 10_000) / area);
  const f = c.fill;
  const fill =
    coverageBps < f.idealMinBps
      ? Math.floor((P.fill * coverageBps) / f.idealMinBps)
      : coverageBps <= f.idealMaxBps
        ? P.fill
        : coverageBps >= f.zeroAtBps
          ? 0
          : Math.floor((P.fill * (f.zeroAtBps - coverageBps)) / (f.zeroAtBps - f.idealMaxBps));

  const rugs = pieces.filter((p) => p.layer === "floor").length;
  const tops = pieces.filter((p) => p.layer === "top").length;
  const rugPoints = Math.floor(P.layers / 2);
  const layers = (rugs > 0 ? rugPoints : 0) + (tops > 0 ? P.layers - rugPoints : 0);

  const n = pieces.length;
  let style = 0;
  if (n > 0) {
    const counts = new Map<string, number>();
    for (const p of pieces) counts.set(p.tier, (counts.get(p.tier) ?? 0) + 1);
    const top = Math.max(...counts.values());
    style = Math.floor((P.style * top * Math.min(n, c.styleMinPieces)) / (n * c.styleMinPieces));
  }

  const floorPoints = Math.min(P.floor, c.floorPoints[floor] ?? 0);
  const parts = { value, variety, fill, layers, style, floor: floorPoints };
  const total = Math.min(100, value + variety + fill + layers + style + floorPoints);
  return { total, parts, valueCents, targetCents, categories, coverageBps, rugs, tops, pieces: n };
}

export type WohnwertTip = "value" | "variety" | "fillLow" | "fillHigh" | "rug" | "top" | "style" | "floor";

/** What raises the Wohnwert most: the parts with the most missing points (at most `limit`). */
export function wohnwertTips(w: Wohnwert, limit = 3, cfg?: RentalsConfig): { tip: WohnwertTip; points: number }[] {
  const c = cfgOf(cfg).wohnwert;
  const P = c.points;
  const rugPoints = Math.floor(P.layers / 2);
  const tips: { tip: WohnwertTip; points: number }[] = [
    { tip: "value", points: P.value - w.parts.value },
    { tip: "variety", points: P.variety - w.parts.variety },
    { tip: w.coverageBps > c.fill.idealMaxBps ? "fillHigh" : "fillLow", points: P.fill - w.parts.fill },
    { tip: "rug", points: w.rugs > 0 ? 0 : rugPoints },
    { tip: "top", points: w.tops > 0 ? 0 : P.layers - rugPoints },
    { tip: "style", points: P.style - w.parts.style },
    { tip: "floor", points: P.floor - w.parts.floor },
  ];
  return tips
    .filter((t) => t.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

export function periodHours(period: RentPeriod): number {
  return period === "day" ? 24 : 1;
}

/** Fair rent per place and hour: from fairMinShareBps of the reference rent at Wohnwert 0 up to all of it at 100. */
export function fairRentCentsPerHour(tier: PropertyTier, wohnwertTotal: number, cfg?: RentalsConfig): number {
  const c = cfgOf(cfg);
  const base = c.baseRentCentsPerHour[tier];
  const w = Math.max(0, Math.min(100, Math.floor(wohnwertTotal)));
  return Math.floor((base * (c.fairMinShareBps * 100 + (10_000 - c.fairMinShareBps) * w)) / 1_000_000);
}

/** The price range an owner may ask per period, and the fair rent per period. */
export function rentLimits(
  tier: PropertyTier,
  wohnwertTotal: number,
  period: RentPeriod,
  cfg?: RentalsConfig,
): { minCents: number; maxCents: number; fairCents: number } {
  const c = cfgOf(cfg);
  const hours = periodHours(period);
  const fair = fairRentCentsPerHour(tier, wohnwertTotal, c);
  const min = Math.max(c.minPriceCents, Math.floor((c.baseRentCentsPerHour[tier] * c.minPriceBps) / 10_000));
  const max = Math.max(min, Math.floor((fair * c.maxPriceBps) / 10_000));
  return { minCents: min * hours, maxCents: max * hours, fairCents: fair * hours };
}

/** Price per hour of an offer (a day price counts as 24 hours, rounded down). */
export function hourlyPrice(priceCents: number, period: RentPeriod): number {
  return Math.floor(priceCents / periodHours(period));
}

/**
 * Chance per free place and check that an AI tenant moves in: none below the minimum Wohnwert, else
 * chanceBps x Wohnwert/100 x price factor, where the price factor is 2 - price/fair (between 0 and 2), capped at 100 %.
 */
export function aiTenantChanceBps(
  tier: PropertyTier,
  wohnwertTotal: number,
  priceCentsPerHour: number,
  cfg?: RentalsConfig,
): number {
  const c = cfgOf(cfg);
  if (wohnwertTotal < c.ai.minWohnwert) return 0;
  const fair = Math.max(1, fairRentCentsPerHour(tier, wohnwertTotal, c));
  const ratio = Math.floor((priceCentsPerHour * 10_000) / fair);
  const factor = Math.max(0, Math.min(c.ai.maxPriceFactorBps, 20_000 - ratio));
  return Math.min(10_000, Math.floor((c.ai.chanceBps * Math.min(100, wohnwertTotal) * factor) / 1_000_000));
}

/** How long an AI tenant stays, from a roll in [0, 1): stayMin..stayMax hours, rounded up to whole periods. */
export function aiStayHours(roll: number, period: RentPeriod, cfg?: RentalsConfig): number {
  const c = cfgOf(cfg).ai;
  const span = c.stayMaxHours - c.stayMinHours + 1;
  const hours = c.stayMinHours + Math.min(span - 1, Math.floor(roll * span));
  const p = periodHours(period);
  return Math.ceil(hours / p) * p;
}

/**
 * When a tenancy ends after notice given at `nowMs`: the first end of a paid period (start + k periods) that is
 * no earlier than both the minimum duration and the notice period.
 */
export function noticeEndMs(startedMs: number, nowMs: number, period: RentPeriod, cfg?: RentalsConfig): number {
  const c = cfgOf(cfg);
  const H = 3_600_000;
  const p = periodHours(period) * H;
  const earliest = Math.max(startedMs + c.minHours * H, nowMs + c.noticeHours * H);
  const k = Math.ceil((earliest - startedMs) / p);
  return startedMs + Math.max(1, k) * p;
}

/** Base XP a player tenant gets for `hours` paid hours in a home with this Wohnwert. */
export function tenantXp(wohnwertTotal: number, hours: number, cfg?: RentalsConfig): number {
  const c = cfgOf(cfg);
  return Math.floor((c.tenantXpPerHour * Math.max(0, Math.min(100, wohnwertTotal)) * hours) / 100);
}

/** AI demand in words for the offer form: none, low, medium, high. */
export function demandLevel(chanceBps: number): "none" | "low" | "medium" | "high" {
  return chanceBps <= 0 ? "none" : chanceBps < 2_000 ? "low" : chanceBps < 5_000 ? "medium" : "high";
}
