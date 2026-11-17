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
  /** Demand (ADR-141): open offers on it and its sales of the last days. */
  readonly openOffers?: number;
  readonly recentSales?: number;
  /** Critic score 0..100 (ADR-181); null or missing counts as neutral. */
  readonly quality?: number | null;
}

/** Quality factor (bps) between min and max: min + (max - min) x score / 100; null = neutral. */
function qualityFactorBps(quality: number | null | undefined, min: number, max: number, cfg: NftConfig): number {
  const q = Math.max(0, Math.min(100, Math.floor(quality ?? cfg.ai.quality.neutral)));
  return min + Math.floor(((max - min) * q) / 100);
}

/** ADR-181: what the score does to the valuation anchor (score 50 = 10 000). */
export function nftQualityValueBps(quality: number | null | undefined, cfg: NftConfig = BALANCE.nfts): number {
  return qualityFactorBps(quality, cfg.ai.quality.valueMinBps, cfg.ai.quality.valueMaxBps, cfg);
}

/** ADR-181: a chance (bps) scaled by the score; 0 below noInterestBelow. */
export function nftQualityChanceBps(
  baseBps: number,
  quality: number | null | undefined,
  cfg: NftConfig = BALANCE.nfts,
): number {
  const q = cfg.ai.quality;
  if (quality !== null && quality !== undefined && quality < q.noInterestBelow) return 0;
  return Math.floor((baseBps * qualityFactorBps(quality, q.chanceMinBps, q.chanceMaxBps, cfg)) / 10_000);
}

/** The anchor from mint cost or floor, scaled by quality. */
function qualityBase(input: NftValueInput, cfg: NftConfig): number {
  return Math.floor(
    (Math.max(input.mintCents ?? 0, cfg.ai.floorCents) * nftQualityValueBps(input.quality, cfg)) / 10_000,
  );
}

/** Demand bonus (ADR-141): open offers and recent sales, each capped. */
export function nftDemandBps(openOffers: number, recentSales: number, cfg: NftConfig = BALANCE.nfts): number {
  const d = cfg.ai.demand;
  return (
    d.offerBps * Math.min(Math.max(0, openOffers), d.maxOffers) +
    d.saleBps * Math.min(Math.max(0, recentSales), d.maxSales)
  );
}

function bonusBps(input: NftValueInput, cfg: NftConfig): number {
  const ai = cfg.ai;
  return (
    ai.likeBps * Math.min(Math.max(0, input.likes), ai.maxLikes) +
    ai.creatorSaleBps * Math.min(Math.max(0, input.creatorSales), ai.maxCreatorSales) +
    ai.ageBpsPerDay * Math.min(Math.max(0, Math.floor(input.ageDays)), ai.maxAgeDays) +
    nftDemandBps(input.openOffers ?? 0, input.recentSales ?? 0, cfg)
  );
}

/** Fair value among collectors (ADR-141): mint cost or floor x bonuses, without the last price. */
export function nftFairCents(input: NftValueInput, cfg: NftConfig = BALANCE.nfts): number {
  const base = qualityBase(input, cfg);
  return Math.floor((base * (10_000 + bonusBps(input, cfg))) / 10_000);
}

/** Chance per minute that another collector buys an NFT a collector holds: higher the more popular it is. */
export function nftAiTradeChanceBps(
  likes: number,
  openOffers: number,
  recentSales: number,
  cfg: NftConfig = BALANCE.nfts,
): number {
  const t = cfg.ai.trade;
  const boost =
    t.likeWeightBps * Math.max(0, likes) +
    t.offerWeightBps * Math.max(0, openOffers) +
    t.saleWeightBps * Math.max(0, recentSales);
  return Math.min(t.maxChanceBps, Math.floor((t.chanceBps * (10_000 + boost)) / 10_000));
}

/**
 * Price of a trade between collectors: the buyer's target is the fair value x taste (u in [0, 1)); the price moves
 * reversion of the way from the last price to that target, rounded to whole euros, at least minAsk.
 */
export function nftAiTradePriceCents(
  lastCents: number | null,
  fairCents: number,
  u: number,
  cfg: NftConfig = BALANCE.nfts,
): number {
  const t = cfg.ai.trade;
  const taste = t.tasteMinBps + Math.floor(Math.min(Math.max(u, 0), 0.999999) * (t.tasteMaxBps - t.tasteMinBps));
  const target = Math.floor((fairCents * taste) / 10_000);
  const last = lastCents ?? target;
  const price = last + Math.trunc(((target - last) * t.reversionBps) / 10_000);
  return Math.max(cfg.minAskCents, Math.round(price / 100) * 100);
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
  const anchor = Math.max(input.lastSaleCents ?? 0, qualityBase(input, cfg));
  return Math.floor((anchor * (10_000 + bonusBps(input, cfg))) / 10_000);
}

/** A collector buys a listing only at a good price: at or below the valuation. */
export function nftAiWouldBuy(askCents: number, valueCents: number): boolean {
  return askCents > 0 && askCents <= valueCents;
}

/** A lowball offer: lowballMin..lowballMax of the valuation (u in [0, 1)), down to whole euros, at least minOffer. */
export function nftLowballCents(
  valueCents: number,
  u: number,
  cfg: NftConfig = BALANCE.nfts,
  quality: number | null = null,
): number {
  const ai = cfg.ai;
  // ADR-181: great art gets closer to its value, poor art lower (truncated like integer division in SQL)
  const shift =
    quality === null ? 0 : Math.trunc(((Math.max(0, Math.min(100, quality)) - 50) * ai.quality.lowballShiftBps) / 50);
  const bps = Math.min(
    10_000,
    ai.lowballMinBps + Math.floor(Math.min(Math.max(u, 0), 0.999999) * (ai.lowballMaxBps - ai.lowballMinBps)) + shift,
  );
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
