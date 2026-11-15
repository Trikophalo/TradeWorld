/**
 * Living bonus (ADR-161): every hour a player who lives in a home gets money and XP. Bigger homes and a higher
 * Wohnwert give more; a tenant gets a share of the bonus of the home he lives in, capped at the rent he pays.
 * Integer arithmetic only, so the database (living_bonus_amounts in
 * supabase/migrations/20261204004300_living_bonus.sql) computes the same numbers.
 */
import { BALANCE } from "../../config/balance.ts";
import type { LivingBonusConfig, PropertyTier } from "../../config/balance.ts";

export interface LivingBonus {
  /** Money per hour. */
  readonly cents: number;
  /** Base XP per hour (before the XP factor). */
  readonly xp: number;
}

export interface LivingSituation {
  /** The own home, if any. */
  readonly own: { readonly tier: PropertyTier; readonly wohnwert: number } | null;
  /** The place rented elsewhere, if any, with the rent per hour. */
  readonly rented: { readonly tier: PropertyTier; readonly wohnwert: number; readonly rentCentsPerHour: number } | null;
}

export type LivingSource = "own" | "tenant";

const cfgOf = (cfg?: LivingBonusConfig) => cfg ?? BALANCE.livingBonus;

/** Share of the full bonus for a Wohnwert, in millionths: minShare at 0, everything at 100. */
function shareE6(wohnwertTotal: number, c: LivingBonusConfig): number {
  const w = Math.max(0, Math.min(100, Math.floor(wohnwertTotal)));
  return c.minShareBps * 100 + (10_000 - c.minShareBps) * w;
}

/** The bonus of the owner who lives in a home of this tier and Wohnwert. */
export function ownerLivingBonus(tier: PropertyTier, wohnwertTotal: number, cfg?: LivingBonusConfig): LivingBonus {
  const c = cfgOf(cfg);
  const s = shareE6(wohnwertTotal, c);
  return {
    cents: Math.floor((c.centsPerHour[tier] * s) / 1_000_000),
    xp: Math.floor((c.xpPerHour[tier] * s) / 1_000_000),
  };
}

/** The bonus of a tenant: tenantShareBps of the owner's bonus of that home, the money at most the rent per hour. */
export function tenantLivingBonus(
  tier: PropertyTier,
  wohnwertTotal: number,
  rentCentsPerHour: number,
  cfg?: LivingBonusConfig,
): LivingBonus {
  const c = cfgOf(cfg);
  const full = ownerLivingBonus(tier, wohnwertTotal, c);
  return {
    cents: Math.min(Math.max(0, rentCentsPerHour), Math.floor((full.cents * c.tenantShareBps) / 10_000)),
    xp: Math.floor((full.xp * c.tenantShareBps) / 10_000),
  };
}

/**
 * The one bonus a player gets per hour: from the own home or from the rented place, whichever brings more money
 * (then more XP; on a tie the own home). Null if the player lives nowhere.
 */
export function livingBonus(
  situation: LivingSituation,
  cfg?: LivingBonusConfig,
): (LivingBonus & { readonly source: LivingSource }) | null {
  const own = situation.own ? ownerLivingBonus(situation.own.tier, situation.own.wohnwert, cfg) : null;
  const rented = situation.rented
    ? tenantLivingBonus(situation.rented.tier, situation.rented.wohnwert, situation.rented.rentCentsPerHour, cfg)
    : null;
  if (own && (!rented || own.cents > rented.cents || (own.cents === rented.cents && own.xp >= rented.xp)))
    return { ...own, source: "own" };
  return rented ? { ...rented, source: "tenant" } : null;
}
