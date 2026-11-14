import { z } from "zod";
import { artworkSchema, toArtwork } from "./api-artworks";
import type { GameEngine, NftChat, NftSale } from "./types";
import { rpc } from "./rpc";

/*
 * NFTs against the server (ADR-135): offer chat, fixed price, buying. snake_case JSON in, camelCase out.
 */
const num = z.number();

const chatSchema = z.object({
  artwork_id: z.string(),
  is_owner: z.boolean(),
  ask_cents: num.nullable(),
  min_offer_cents: num,
  max_length: num,
  my_offer_cents: num.nullable(),
  messages: z.array(
    z.object({
      id: num,
      author: z.string().nullable(),
      ai: z.boolean(),
      kind: z.enum(["chat", "offer", "sale"]),
      text: z.string(),
      offer_cents: num.nullable(),
      offer_status: z.enum(["open", "accepted", "declined", "closed", "expired"]).nullable(),
      expires_at: z.string().nullable(),
      at: z.string(),
      mine: z.boolean(),
    }),
  ),
});

const saleSchema = z.object({ artwork: artworkSchema, price_cents: num, fee_cents: num, royalty_cents: num });

export const NFT_RPC_SCHEMAS = {
  get_artwork_chat: chatSchema,
  post_artwork_message: chatSchema,
  accept_artwork_offer: saleSchema,
  set_artwork_price: z.object({ artwork: artworkSchema }),
  buy_artwork: saleSchema,
} as const;

const toChat = (r: z.infer<typeof chatSchema>): NftChat => ({
  artworkId: r.artwork_id,
  isOwner: r.is_owner,
  askCents: r.ask_cents,
  minOfferCents: r.min_offer_cents,
  maxLength: r.max_length,
  myOfferCents: r.my_offer_cents,
  messages: r.messages.map((m) => ({
    id: m.id,
    author: m.author,
    ai: m.ai,
    kind: m.kind,
    text: m.text,
    offerCents: m.offer_cents,
    offerStatus: m.offer_status,
    expiresAt: m.expires_at,
    at: m.at,
    mine: m.mine,
  })),
});

const toSale = (r: z.infer<typeof saleSchema>): NftSale => ({
  artwork: toArtwork(r.artwork),
  priceCents: r.price_cents,
  feeCents: r.fee_cents,
  royaltyCents: r.royalty_cents,
});

export const liveNftEngine: Pick<
  GameEngine,
  "artworkChat" | "postArtworkMessage" | "acceptArtworkOffer" | "setArtworkPrice" | "buyArtwork"
> = {
  async artworkChat(artworkId) {
    return toChat(await rpc("get_artwork_chat", { p_artwork_id: artworkId }, chatSchema));
  },
  async postArtworkMessage(requestId, artworkId, text, offerCents) {
    return toChat(
      await rpc(
        "post_artwork_message",
        { p_request_id: requestId, p_artwork_id: artworkId, p_text: text, p_offer_cents: offerCents },
        chatSchema,
      ),
    );
  },
  async acceptArtworkOffer(requestId, messageId) {
    return toSale(await rpc("accept_artwork_offer", { p_request_id: requestId, p_message_id: messageId }, saleSchema));
  },
  async setArtworkPrice(requestId, artworkId, askCents) {
    const r = await rpc(
      "set_artwork_price",
      { p_request_id: requestId, p_artwork_id: artworkId, p_ask_cents: askCents },
      NFT_RPC_SCHEMAS.set_artwork_price,
    );
    return toArtwork(r.artwork);
  },
  async buyArtwork(requestId, artworkId, priceCents) {
    return toSale(
      await rpc(
        "buy_artwork",
        { p_request_id: requestId, p_artwork_id: artworkId, p_price_cents: priceCents },
        saleSchema,
      ),
    );
  },
};
