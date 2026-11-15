import type { FloorMaterial, PropertyTier } from "@/config/balance";
import { FURNITURE } from "@/config/furniture";
import { wohnwert, type Wohnwert, type WohnwertPiece } from "@/lib/sim/rentals";

/*
 * The Wohnwert (ADR-158) of a layout from the furniture catalogue: the editor shows it live, the demo uses it like
 * home_wohnwert() on the server.
 */
const BY_KEY = new Map(FURNITURE.map((f) => [f.key, f]));

export function piecesOf(itemKeys: readonly string[]): WohnwertPiece[] {
  return itemKeys.flatMap((key) => {
    const f = BY_KEY.get(key);
    return f ? [{ category: f.category, tier: f.tier, priceCents: f.priceCents, w: f.w, h: f.h, layer: f.layer }] : [];
  });
}

export function layoutWohnwert(tier: PropertyTier, floor: FloorMaterial, itemKeys: readonly string[]): Wohnwert {
  return wohnwert(tier, floor, piecesOf(itemKeys));
}
