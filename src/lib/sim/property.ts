/**
 * Own home (ADR-082, docs/PROPERTY.md): tiers, placing furniture on the floor grid, upgrade and resale prices.
 * The database checks the same rules.
 */
import { BALANCE } from "../../config/balance.ts";
import type { PropertyConfig, PropertyTier } from "../../config/balance.ts";

export interface Placement {
  /** Inventory item id. */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** 0 or 90 degrees (furniture is drawn from above; 90 swaps width and height). */
  readonly rot: 0 | 90;
}

export interface Footprint {
  readonly w: number;
  readonly h: number;
  /** floor = rugs, object = furniture, top = small things standing on a surface (ADR-100). */
  readonly layer: "floor" | "object" | "top";
  /** Objects whose surface carries top-layer things (tables, counters, desks). */
  readonly surface?: boolean;
}

export function tierConfig(tier: PropertyTier, cfg: PropertyConfig = BALANCE.property) {
  const t = cfg.tiers.find((x) => x.key === tier);
  if (!t) throw new Error(`unknown tier ${tier}`);
  return t;
}

export function tierIndex(tier: PropertyTier | null, cfg: PropertyConfig = BALANCE.property): number {
  return tier === null ? -1 : cfg.tiers.findIndex((x) => x.key === tier);
}

/** The next home up the ladder, or null at the top. */
export function nextTier(tier: PropertyTier | null, cfg: PropertyConfig = BALANCE.property): PropertyTier | null {
  return cfg.tiers[tierIndex(tier, cfg) + 1]?.key ?? null;
}

/** What moving into `target` costs: its price minus the trade-in of the current home. */
export function upgradeCostCents(
  current: PropertyTier | null,
  target: PropertyTier,
  cfg: PropertyConfig = BALANCE.property,
): number {
  const price = tierConfig(target, cfg).priceCents;
  const tradeIn = current ? Math.floor((tierConfig(current, cfg).priceCents * cfg.tradeInBps) / 10_000) : 0;
  return Math.max(0, price - tradeIn);
}

/** What selling a piece of furniture or a car brings back. */
export function resaleCents(priceCents: number, cfg: PropertyConfig = BALANCE.property): number {
  return Math.floor((priceCents * cfg.resaleBps) / 10_000);
}

/** Size on the floor after rotation. */
export function rotated(f: Footprint, rot: 0 | 90): { w: number; h: number } {
  return rot === 90 ? { w: f.h, h: f.w } : { w: f.w, h: f.h };
}

/**
 * Checks a whole layout: every piece inside the floor and no two pieces of the same layer on the same tile
 * (rugs lie under furniture). Things of the top layer must stand completely on surfaces (tables, counters, desks,
 * ADR-100). Returns the ids that break a rule (empty = fine).
 */
export function invalidPlacements(
  placements: readonly Placement[],
  footprint: (id: string) => Footprint | undefined,
  width: number,
  height: number,
): string[] {
  const bad = new Set<string>();
  const used = { floor: new Map<number, string>(), object: new Map<number, string>(), top: new Map<number, string>() };
  const surfaces = new Set<number>();
  const tops: { id: string; cells: number[] }[] = [];
  for (const p of placements) {
    const f = footprint(p.id);
    if (!f) {
      bad.add(p.id);
      continue;
    }
    const { w, h } = rotated(f, p.rot);
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 0 || p.y < 0 || p.x + w > width || p.y + h > height) {
      bad.add(p.id);
      continue;
    }
    const cells: number[] = [];
    for (let y = p.y; y < p.y + h; y++) {
      for (let x = p.x; x < p.x + w; x++) {
        const cell = y * width + x;
        cells.push(cell);
        if (f.layer === "object" && f.surface) surfaces.add(cell);
        const other = used[f.layer].get(cell);
        if (other !== undefined && other !== p.id) {
          bad.add(p.id);
          bad.add(other);
        } else used[f.layer].set(cell, p.id);
      }
    }
    if (f.layer === "top") tops.push({ id: p.id, cells });
  }
  for (const t of tops) if (!t.cells.every((c) => surfaces.has(c))) bad.add(t.id);
  return [...bad];
}

/** Value of a home for the net worth: trade-in of the home plus resale of everything bought for it. */
export function propertyValueCents(
  tier: PropertyTier | null,
  itemPricesCents: readonly number[],
  cfg: PropertyConfig = BALANCE.property,
): number {
  const home = tier ? Math.floor((tierConfig(tier, cfg).priceCents * cfg.tradeInBps) / 10_000) : 0;
  return home + itemPricesCents.reduce((sum, p) => sum + resaleCents(p, cfg), 0);
}
