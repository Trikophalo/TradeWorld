import { z } from "zod";
import { NEXAMON_SETS } from "@/config/nexamon/types";
import type { GameEngine, NewsPromoState } from "./types";
import { rpc } from "./rpc";

/*
 * News-Aktionen (ADR-193): the running promotion and the tax return, against the server.
 */
const promoSchema = z.object({
  now: z.string(),
  promo: z
    .object({
      id: z.number(),
      kind: z.enum(["pack_sale", "free_nft", "tax_return"]),
      set: z.enum(NEXAMON_SETS).nullable().catch(null),
      bps: z.number(),
      starts_at: z.string(),
      ends_at: z.string(),
      headline: z.string(),
      text: z.string(),
      claimed: z.boolean(),
      claimed_cents: z.number().nullable(),
      tax: z
        .object({
          owner: z.boolean(),
          revenue_cents: z.number(),
          refund_cents: z.number(),
          cap_cents: z.number(),
          share_bps: z.number(),
        })
        .nullable(),
    })
    .nullable(),
});
const taxSchema = z.object({ promo_id: z.number(), refund_cents: z.number(), revenue_cents: z.number() });

export const NEWS_PROMO_RPC_SCHEMAS = {
  get_news_promo: promoSchema,
  file_news_tax_return: taxSchema,
} as const;

function toState(r: z.infer<typeof promoSchema>): NewsPromoState {
  const p = r.promo;
  return {
    now: r.now,
    promo: p && {
      id: p.id,
      kind: p.kind,
      set: p.set,
      bps: p.bps,
      startsAt: p.starts_at,
      endsAt: p.ends_at,
      headline: p.headline,
      text: p.text,
      claimed: p.claimed,
      claimedCents: p.claimed_cents ?? 0,
      tax: p.tax && {
        owner: p.tax.owner,
        revenueCents: p.tax.revenue_cents,
        refundCents: p.tax.refund_cents,
        capCents: p.tax.cap_cents,
        shareBps: p.tax.share_bps,
      },
    },
  };
}

export const liveNewsPromoEngine: Pick<GameEngine, "newsPromo" | "fileNewsTaxReturn"> = {
  async newsPromo() {
    return toState(await rpc("get_news_promo", {}, promoSchema));
  },
  async fileNewsTaxReturn(requestId) {
    const r = await rpc("file_news_tax_return", { p_request_id: requestId }, taxSchema);
    return { promoId: r.promo_id, refundCents: r.refund_cents, revenueCents: r.revenue_cents };
  },
};
