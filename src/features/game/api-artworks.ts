import { z } from "zod";
import type { Artwork, GameEngine, GameErrorKey } from "./types";
import { rpc } from "./rpc";

/*
 * Artworks against the server (ADR-080, docs/ARTWORKS.md). snake_case JSON in, camelCase out.
 */
const num = z.number();
const iso = z.string();

const auctionSchema = z.object({
  id: z.string(),
  ends_at: iso,
  start_cents: num,
  current_cents: num.nullable(),
  min_bid_cents: num,
  bids: num,
  leader: z.string().nullable(),
  seller: z.string().nullable(),
  my_bid_cents: num.nullable(),
});

const artworkSchema = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  origin: z.enum(["game", "player"]),
  rarity: z.enum(["common", "rare", "legendary"]).nullable(),
  creator: z.string().nullable(),
  owner: z.string().nullable(),
  pixels: z.object({ palette: z.array(z.string()), grid: z.array(z.string()) }),
  value_cents: num.nullable(),
  likes: num,
  liked: z.boolean(),
  created_at: iso,
  hot: num,
  auction: auctionSchema.nullable(),
});
type ArtworkRow = z.infer<typeof artworkSchema>;

export const ARTWORK_RPC_SCHEMAS = {
  get_artworks: z.object({ server_time: iso, total: num, entries: z.array(artworkSchema) }),
  get_artwork: z.object({
    artwork: artworkSchema,
    sales: z.array(z.object({ at: iso, price_cents: num, seller: z.string().nullable(), buyer: z.string() })),
    bids: z.array(z.object({ nickname: z.string(), amount_cents: num, at: iso })),
  }),
  get_art_studio: z.object({ painted: num, next_cost_cents: num, unlocked: z.boolean() }),
  create_artwork: z.object({ artwork: artworkSchema, cost_cents: num, next_cost_cents: num }),
  check_artwork_title: z.object({ allowed: z.boolean(), reason: z.string().nullable() }),
  like_artwork: z.object({ likes: num, liked: z.boolean() }),
  start_auction: z.object({ artwork: artworkSchema }),
  cancel_auction: z.object({ artwork: artworkSchema }),
  bid_artwork: z.object({ artwork: artworkSchema }),
  get_art_rankings: z.object({
    collections: z.array(
      z.object({
        rank: num,
        nickname: z.string(),
        avatar_key: z.string().nullable(),
        count: num,
        value_cents: num,
        is_me: z.boolean(),
      }),
    ),
    artworks: z.array(z.object({ rank: num, artwork: artworkSchema })),
  }),
  get_collection: z.object({ nickname: z.string(), count: num, value_cents: num, artworks: z.array(artworkSchema) }),
};
const S = ARTWORK_RPC_SCHEMAS;

export function toArtwork(a: ArtworkRow): Artwork {
  return {
    id: a.id,
    code: a.code,
    title: a.title,
    origin: a.origin,
    rarity: a.rarity,
    creator: a.creator,
    owner: a.owner,
    pixels: a.pixels,
    valueCents: a.value_cents,
    likes: a.likes,
    liked: a.liked,
    createdAt: a.created_at,
    hot: a.hot,
    auction: a.auction
      ? {
          id: a.auction.id,
          endsAt: a.auction.ends_at,
          startCents: a.auction.start_cents,
          currentCents: a.auction.current_cents,
          minBidCents: a.auction.min_bid_cents,
          bids: a.auction.bids,
          leader: a.auction.leader,
          seller: a.auction.seller,
          myBidCents: a.auction.my_bid_cents,
        }
      : null,
  };
}

type ArtEngine = Pick<
  GameEngine,
  | "artworks"
  | "artwork"
  | "artStudio"
  | "checkArtworkTitle"
  | "createArtwork"
  | "likeArtwork"
  | "startAuction"
  | "cancelAuction"
  | "bidArtwork"
  | "artRankings"
  | "collection"
>;

export const liveArtEngine: ArtEngine = {
  async artworks(sort, origin, onAuction, limit, offset) {
    const r = await rpc(
      "get_artworks",
      { p_sort: sort, p_origin: origin, p_on_auction: onAuction, p_limit: limit, p_offset: offset },
      S.get_artworks,
    );
    return { serverTime: r.server_time, total: r.total, entries: r.entries.map(toArtwork) };
  },
  async artwork(id) {
    const r = await rpc("get_artwork", { p_artwork_id: id }, S.get_artwork);
    return {
      artwork: toArtwork(r.artwork),
      sales: r.sales.map((s) => ({ at: s.at, priceCents: s.price_cents, seller: s.seller, buyer: s.buyer })),
      bids: r.bids.map((b) => ({ nickname: b.nickname, amountCents: b.amount_cents, at: b.at })),
    };
  },
  async artStudio() {
    const r = await rpc("get_art_studio", {}, S.get_art_studio);
    return { painted: r.painted, nextCostCents: r.next_cost_cents, unlocked: r.unlocked };
  },
  async checkArtworkTitle(title) {
    const r = await rpc("check_artwork_title", { p_title: title }, S.check_artwork_title);
    return { allowed: r.allowed, reason: r.reason as GameErrorKey | null };
  },
  async createArtwork(requestId, title, pixels) {
    const r = await rpc(
      "create_artwork",
      { p_request_id: requestId, p_title: title, p_pixels: pixels },
      S.create_artwork,
    );
    return { artwork: toArtwork(r.artwork), costCents: r.cost_cents, nextCostCents: r.next_cost_cents };
  },
  async likeArtwork(requestId, artworkId, like) {
    return rpc("like_artwork", { p_request_id: requestId, p_artwork_id: artworkId, p_like: like }, S.like_artwork);
  },
  async startAuction(requestId, artworkId, startCents, hours) {
    const r = await rpc(
      "start_auction",
      { p_request_id: requestId, p_artwork_id: artworkId, p_start_cents: startCents, p_hours: hours },
      S.start_auction,
    );
    return toArtwork(r.artwork);
  },
  async cancelAuction(requestId, auctionId) {
    const r = await rpc("cancel_auction", { p_request_id: requestId, p_auction_id: auctionId }, S.cancel_auction);
    return toArtwork(r.artwork);
  },
  async bidArtwork(requestId, auctionId, amountCents) {
    const r = await rpc(
      "bid_artwork",
      { p_request_id: requestId, p_auction_id: auctionId, p_amount_cents: amountCents },
      S.bid_artwork,
    );
    return toArtwork(r.artwork);
  },
  async artRankings(limit) {
    const r = await rpc("get_art_rankings", { p_limit: limit }, S.get_art_rankings);
    return {
      collections: r.collections.map((c) => ({
        rank: c.rank,
        nickname: c.nickname,
        avatarKey: c.avatar_key,
        count: c.count,
        valueCents: c.value_cents,
        isMe: c.is_me,
      })),
      artworks: r.artworks.map((a) => ({ rank: a.rank, artwork: toArtwork(a.artwork) })),
    };
  },
  async collection(nickname) {
    const r = await rpc("get_collection", { p_nickname: nickname }, S.get_collection);
    return { nickname: r.nickname, count: r.count, valueCents: r.value_cents, artworks: r.artworks.map(toArtwork) };
  },
};
