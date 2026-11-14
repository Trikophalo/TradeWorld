/**
 * NFTs (ADR-135): royalties for the creator, the AI collectors' valuation, lowball offers and resale prices.
 * The database runs the same rules in PL/pgSQL (supabase/migrations/20261204000800_nfts.sql); the demo and the UI
 * use these.
 */
import { BALANCE } from "../../config/balance.ts";

type NftConfig = typeof BALANCE.nfts;
type FeeConfig = typeof BALANCE.artworks;

export interface NftValueInput {
  /** Last sale price, null if never sold. */
  readonly lastSaleCents: number | null;
  /** What minting cost (player NFTs) or the gallery's start price (NFTs of the game); null if unknown. */
  readonly mintCents: number | null;
  readonly likes: number;
  /** Sales of NFTs by the same creator so far (reputation). */
  readonly creatorSales: number;
  readonly ageDays: number;
}

/** Royalty of the creator on a resale: price x royaltyBps, rounded down; nothing when the creator sells. */
export function nftRoyaltyCents(priceCents: number, sellerIsCreator: boolean, cfg: NftConfig = BALANCE.nfts): number {
  if (sellerIsCreator || priceCents <= 0) return 0;
  return Math.floor((priceCents * cfg.royaltyBps) / 10_000);
}

/** How a sale is split: fee to the households, royalty to the creator, the rest to the seller. */
export function nftSaleSplit(
  priceCents: number,
  sellerIsCreator: boolean,
  cfg: NftConfig = BALANCE.nfts,
  fees: FeeConfig = BALANCE.artworks,
): { feeCents: number; royaltyCents: number; sellerCents: number } {
  const feeCents = Math.floor((priceCents * fees.auction.feeBps) / 10_000);
  const royaltyCents = nftRoyaltyCents(priceCents, sellerIsCreator, cfg);
  return { feeCents, royaltyCents, sellerCents: priceCents - feeCents - royaltyCents };
}

/**
 * The AI collectors' valuation: anchor x (10 000 + bonuses) / 10 000, rounded down. Anchor = the highest of last
 * price, mint cost and floor; bonuses for likes, the creator's reputation and age (each capped).
 */
export function nftAiValueCents(input: NftValueInput, cfg: NftConfig = BALANCE.nfts): number {
  const ai = cfg.ai;
  const anchor = Math.max(input.lastSaleCents ?? 0, input.mintCents ?? 0, ai.floorCents);
  const bonus =
    ai.likeBps * Math.min(Math.max(0, input.likes), ai.maxLikes) +
    ai.creatorSaleBps * Math.min(Math.max(0, input.creatorSales), ai.maxCreatorSales) +
    ai.ageBpsPerDay * Math.min(Math.max(0, Math.floor(input.ageDays)), ai.maxAgeDays);
  return Math.floor((anchor * (10_000 + bonus)) / 10_000);
}

/** A collector buys a listing only at a good price: at or below the valuation. */
export function nftAiWouldBuy(askCents: number, valueCents: number): boolean {
  return askCents > 0 && askCents <= valueCents;
}

/** A lowball offer: lowballMin..lowballMax of the valuation (u in [0, 1)), down to whole euros, at least minOffer. */
export function nftLowballCents(valueCents: number, u: number, cfg: NftConfig = BALANCE.nfts): number {
  const ai = cfg.ai;
  const bps = ai.lowballMinBps + Math.floor(Math.min(Math.max(u, 0), 0.999999) * (ai.lowballMaxBps - ai.lowballMinBps));
  return Math.max(cfg.minOfferCents, Math.floor((valueCents * bps) / 10_000 / 100) * 100);
}

/** What the AI asks for an NFT it holds: valuation x resaleMarkup, up to whole euros. */
export function nftAiAskCents(valueCents: number, cfg: NftConfig = BALANCE.nfts): number {
  return Math.ceil((valueCents * cfg.ai.resaleMarkupBps) / 10_000 / 100) * 100;
}

/** The AI accepts a player's offer on an NFT it holds from acceptBps of its valuation. */
export function nftAiAccepts(offerCents: number, valueCents: number, cfg: NftConfig = BALANCE.nfts): boolean {
  return offerCents * 10_000 >= valueCents * cfg.ai.acceptBps;
}
