/**
 * Pixel artworks and their auctions (ADR-080, docs/ARTWORKS.md). The database runs the same rules in PL/pgSQL;
 * the demo and the UI use these.
 */
import { BALANCE } from "../../config/balance.ts";
import type { ArtworksConfig } from "../../config/balance.ts";

export interface ArtworkPixels {
  readonly palette: readonly string[];
  readonly grid: readonly string[];
}

const HEX = /^#[0-9a-f]{6}$/;
/** Palette indices 0..15 as one character each: 0-9 then a-f. */
export const ART_INDEX = "0123456789abcdef";

/** size × size, up to maxColors, one character per pixel ("." empty, else a palette index), at least a few pixels. */
export function isValidArtwork(art: unknown, cfg: ArtworksConfig = BALANCE.artworks): art is ArtworkPixels {
  if (!art || typeof art !== "object") return false;
  const { palette, grid } = art as { palette?: unknown; grid?: unknown };
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > cfg.maxColors) return false;
  if (!palette.every((c) => typeof c === "string" && HEX.test(c))) return false;
  if (!Array.isArray(grid) || grid.length !== cfg.size) return false;
  const allowed = new Set([".", ...ART_INDEX.slice(0, palette.length)]);
  for (const row of grid) {
    if (typeof row !== "string" || row.length !== cfg.size) return false;
    for (const c of row) if (!allowed.has(c)) return false;
  }
  return grid.join("").replace(/\./g, "").length >= 16;
}

/** Cost of painting the next artwork: base × factor ^ artworks already painted. */
export function artworkCreateCostCents(alreadyPainted: number, cfg: ArtworksConfig = BALANCE.artworks): number {
  return Math.round(cfg.createBaseCostCents * Math.pow(cfg.createCostFactor, Math.max(0, alreadyPainted)));
}

/** The lowest valid next bid: the start price, or the current bid plus the increment, rounded up to whole euros. */
export function minNextBidCents(
  startCents: number,
  currentCents: number | null,
  cfg: ArtworksConfig = BALANCE.artworks,
): number {
  if (currentCents === null) return startCents;
  return Math.ceil((currentCents * (10_000 + cfg.auction.minIncrementBps)) / 10_000 / 100) * 100;
}

/** A bid shortly before the end extends the auction (no sniping in the last second). */
export function endAfterBid(endsAtMs: number, nowMs: number, cfg: ArtworksConfig = BALANCE.artworks): number {
  const window = cfg.auction.antiSnipeMinutes * 60_000;
  return endsAtMs - nowMs < window ? nowMs + window : endsAtMs;
}

/** What the seller receives: the price minus the fee (which goes back into circulation). */
export function sellerProceedsCents(priceCents: number, cfg: ArtworksConfig = BALANCE.artworks): number {
  return priceCents - Math.floor((priceCents * cfg.auction.feeBps) / 10_000);
}

/** Popularity for the marketplace: likes and bids count, age makes it fade. */
export function hotScore(
  likes: number,
  bids: number,
  ageHours: number,
  cfg: ArtworksConfig = BALANCE.artworks,
): number {
  return (
    (likes * cfg.hot.likeWeight + bids * cfg.hot.bidWeight + 1) / Math.pow(Math.max(0, ageHours) + 2, cfg.hot.gravity)
  );
}

/** Display code of an NFT: "NFT-0042" (ADR-135; was ART-0042). */
export function artworkCode(serial: number): string {
  return `NFT-${String(serial).padStart(4, "0")}`;
}
