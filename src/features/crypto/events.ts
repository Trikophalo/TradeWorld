"use client";

import { useTranslations } from "next-intl";
import type { CryptoEvent } from "@/features/game/types";

/** Event keys with their own sentence (random events, coin life cycle). */
const KNOWN = new Set([
  "hack",
  "bug",
  "influencer",
  "exchange_listing",
  "delisting_rumor",
  "whale_buy",
  "whale_dump",
  "partnership",
  "fud",
  "network_upgrade",
  "depeg",
  "meme_wave",
  "regulation",
  "rug_pull",
  "dead",
  "listed",
  "launch",
  "created",
  "closed",
  "delisted",
  "burn",
  "exposed",
]);

const ACTIONS = new Set([
  "smart_contract",
  "audit",
  "community",
  "influencer",
  "partnership",
  "staking",
  "bugfix",
  "marketing_burn",
]);

/** The sentence for a crypto event; the server sends keys and a payload, the client the words. */
export function useCryptoEventText() {
  const t = useTranslations("crypto.events");
  const ta = useTranslations("crypto.studio.actions");
  return (e: CryptoEvent): string => {
    const name = e.name || e.ticker;
    if (KNOWN.has(e.key)) return t(e.key as "hack", { name });
    const action = typeof e.payload.action === "string" ? e.payload.action : null;
    if (e.key === "action" && action && ACTIONS.has(action))
      return t(e.payload.success === true ? "actionOk" : "actionFail", { name, action: ta(action as "audit") });
    return t("other", { name });
  };
}

/** Market-wide events carry no single coin. */
export const isMarketEvent = (e: CryptoEvent) => e.ticker === "*" || e.ticker === "";
