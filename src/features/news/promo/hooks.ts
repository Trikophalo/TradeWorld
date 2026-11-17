"use client";

import { useQuery } from "@tanstack/react-query";
import { useServerClock } from "@/features/game/server-clock";
import { engine } from "@/features/game/store";
import type { NewsPromo, NewsPromoKind } from "@/features/game/types";
import { promoPackPriceCents } from "@/lib/sim/news-promos";

export const NEWS_PROMO_KEY = ["news", "promo"] as const;

/** Where each promotion is used. */
export const NEWS_PROMO_HREF: Record<NewsPromoKind, string> = {
  pack_sale: "/nexamon",
  free_nft: "/artworks",
  tax_return: "/news#news-promo",
};

/** The running News-Aktion (ADR-193), or null once it has ended by the server clock. */
export function useNewsPromo(preview?: NewsPromo | null) {
  const query = useQuery({
    queryKey: NEWS_PROMO_KEY,
    queryFn: () => engine.newsPromo(),
    refetchInterval: 30_000,
    enabled: preview === undefined,
  });
  const now = useServerClock();
  if (preview !== undefined) return { promo: preview, isPending: false };
  const promo = query.data?.promo ?? null;
  const running = promo && (now === null || Date.parse(promo.endsAt) > now) ? promo : null;
  return { promo: running, isPending: query.isPending };
}

/** Display price of a pack during a pack sale of its set (the server charges the same). */
export function promoPackPrice(promo: NewsPromo | null, set: string, priceCents: number): number {
  if (!promo || promo.kind !== "pack_sale" || promo.set !== set) return priceCents;
  return Number(promoPackPriceCents(BigInt(priceCents), promo.bps));
}
