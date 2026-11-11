"use client";

import { useTranslations } from "next-intl";
import { GAME_ERROR_KEYS, GameError } from "./types";

/** Turns any thrown value into a player-readable sentence (messages: "errors"). */
export function useGameErrorText() {
  const t = useTranslations("errors");
  return (error: unknown): string => {
    const key = error instanceof GameError ? error.key : "unknown";
    return (GAME_ERROR_KEYS as readonly string[]).includes(key)
      ? t(key as (typeof GAME_ERROR_KEYS)[number])
      : t("unknown");
  };
}
