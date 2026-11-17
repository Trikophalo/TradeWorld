/*
 * News-Aktionen (ADR-193): the draw of a promotion and its two amounts. The database runs the same rules
 * (supabase/migrations/20261204008100_news_promos.sql); the demo and the UI use these.
 */
import { applyBps } from "./money.ts";

/**
 * Which promotion a show brings, or null. `chanceRoll` and `pickRoll` are uniform in [0, 1). The kind of the
 * previous promotion is left out, so the same kind never comes twice in a row.
 */
export function drawNewsPromoKind<K extends string>(
  kinds: readonly K[],
  last: K | null,
  chanceBps: number,
  chanceRoll: number,
  pickRoll: number,
): K | null {
  if (chanceRoll * 10_000 >= chanceBps) return null;
  const open = kinds.filter((kind) => kind !== last);
  if (open.length === 0) return null;
  return open[Math.min(open.length - 1, Math.floor(pickRoll * open.length))]!;
}

/** Pack price during a pack sale: `price x (10 000 − discount) / 10 000`, rounded half to even. */
export function promoPackPriceCents(priceCents: bigint, discountBps: number): bigint {
  return applyBps(priceCents, 10_000 - discountBps);
}

/** Tax refund: `share` of the revenue, never negative, at most `cap`. */
export function taxRefundCents(revenueCents: bigint, shareBps: number, capCents: bigint): bigint {
  if (revenueCents <= 0n) return 0n;
  const refund = applyBps(revenueCents, shareBps);
  return refund > capCents ? capCents : refund;
}
