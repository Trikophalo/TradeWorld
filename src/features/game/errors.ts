"use client";

import { useTranslations } from "next-intl";
import { GAME_ERROR_KEYS, GameError } from "./types";

/** Turns any thrown value into a player-readable sentence (messages: "errors"). */
export function useGameErrorText() {
  const t = useTranslations("errors");
  return (error: unknown): string => {
    const key = error instanceof GameError ? error.key : "unknown";
    // ADR-182 Nachtrag: a rate limit that says how long it lasts
    const wait = error instanceof GameError ? error.retryAfterSeconds : undefined;
    if (key === "rate_limited" && wait) return t("rateLimitedWait", { seconds: wait });
    if ((GAME_ERROR_KEYS as readonly string[]).includes(key)) return t(key as (typeof GAME_ERROR_KEYS)[number]);
    // The server refused with something the game has no sentence for: say what it said.
    const detail = error instanceof GameError ? error.detail : undefined;
    return detail ? t("unknownDetail", { detail }) : t("unknown");
  };
}
