import type { FloorMaterial, PropertyTier } from "@/config/balance";
import { FURNITURE } from "@/config/furniture";
import { wohnwert, type Wohnwert, type WohnwertPiece } from "@/lib/sim/rentals";

/*
 * The Wohnwert (ADR-158) of a layout from the furniture catalogue: the editor shows it live, the demo uses it like
 * home_wohnwert() on the server.
 */
const BY_KEY = new Map(FURNITURE.map((f) => [f.key, f]));

/** A placed piece: its catalogue key and the list price it was bought at (ADR-161; default: the catalogue price). */
export type LayoutPiece = string | { readonly itemKey: string; readonly valueCents?: number };

export function piecesOf(items: readonly LayoutPiece[]): WohnwertPiece[] {
  return items.flatMap((item) => {
    const key = typeof item === "string" ? item : item.itemKey;
    const f = BY_KEY.get(key);
    const priceCents = typeof item === "string" ? undefined : item.valueCents;
    return f
      ? [{ category: f.category, tier: f.tier, priceCents: priceCents ?? f.priceCents, w: f.w, h: f.h, layer: f.layer }]
      : [];
  });
}

export function layoutWohnwert(tier: PropertyTier, floor: FloorMaterial, items: readonly LayoutPiece[]): Wohnwert {
  return wohnwert(tier, floor, piecesOf(items));
}
