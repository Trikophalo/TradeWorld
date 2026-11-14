"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Countdown } from "@/components/ui/countdown";
import { ShortMoney } from "@/components/ui/live-money";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import type { Artwork } from "@/features/game/types";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useArtRefresh } from "../hooks";
import { ArtworkImage } from "./artwork-image";

/** Who made it: the gallery of the game or a player, always visible (ADR-080). */
export function OriginLabel({ artwork }: { artwork: Pick<Artwork, "origin" | "creator" | "rarity"> }) {
  const t = useTranslations("art");
  if (artwork.origin === "game") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 label-pixel text-2xs",
          artwork.rarity === "legendary"
            ? "bg-gold/20 text-gold"
            : artwork.rarity === "rare"
              ? "bg-fg-2/15 text-fg-1"
              : "bg-surface-3 text-fg-2",
        )}
      >
        {artwork.rarity && artwork.rarity !== "common" ? t(`rarity.${artwork.rarity}`) : t("gallery")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-xs bg-accent-soft px-1.5 py-0.5 text-2xs text-accent">
      {t("byPlayer", { name: artwork.creator ?? "?" })}
    </span>
  );
}

export function LikeButton({ artwork, className }: { artwork: Artwork; className?: string }) {
  const t = useTranslations("art");
  const errorText = useGameErrorText();
  const refresh = useArtRefresh();
  const me = useGame((state) => state.portfolio?.nickname);
  const [optimistic, setOptimistic] = useState<{ liked: boolean; likes: number } | null>(null);
  const liked = optimistic?.liked ?? artwork.liked;
  const likes = optimistic?.likes ?? artwork.likes;
  const own = artwork.owner === me || artwork.creator === me;
  const toggle = async () => {
    if (own) return;
    haptic("tap");
    void playSound(liked ? "tap" : "success", 0.4);
    setOptimistic({ liked: !liked, likes: likes + (liked ? -1 : 1) });
    try {
      const r = await engine.likeArtwork(crypto.randomUUID(), artwork.id, !liked);
      setOptimistic(r);
      void refresh();
    } catch (error) {
      setOptimistic(null);
      toast.error(t("like"), errorText(error));
    }
  };
  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={liked ? t("unlike") : t("like")}
      disabled={own}
      onClick={(event) => {
        event.stopPropagation();
        void toggle();
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2 py-1 text-xs focus-ring transition duration-fast active:scale-90 disabled:cursor-default",
        liked ? "bg-loss-soft text-loss" : "bg-surface-2 text-fg-2 hover:text-loss",
        className,
      )}
    >
      <motion.span
        key={String(liked)}
        initial={{ scale: liked ? 0.4 : 1 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 14 }}
      >
        <PixelIcon {...UI_ICONS.heart} scale={1} />
      </motion.span>
      <span className="nums">{likes}</span>
    </button>
  );
}

/** One artwork in the marketplace: framed picture, label, price or auction, likes. */
export function ArtworkCard({ artwork, onOpen, big }: { artwork: Artwork; onOpen: () => void; big?: boolean }) {
  const t = useTranslations("art");
  const a = artwork.auction;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        haptic("tap");
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      data-testid="artwork-card"
      data-artwork={artwork.code}
      className="group flex h-full cursor-pointer flex-col gap-3 rounded-lg border border-line-1 bg-surface-1 p-3 shadow-1 focus-ring transition duration-fast hover:-translate-y-1 hover:border-line-2 hover:shadow-2 active:translate-y-0 active:scale-[0.98]"
    >
      <div className="grid place-items-center rounded-md bg-surface-2 py-3">
        <ArtworkImage
          artwork={artwork}
          scale={big ? 5 : 3}
          className="transition-transform duration-base group-hover:scale-[1.03]"
        />
      </div>
      <div className="min-w-0 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="label-pixel nums text-2xs text-fg-3">{artwork.code}</span>
          <OriginLabel artwork={artwork} />
        </div>
        <p className="truncate font-semibold text-fg-1">{artwork.title}</p>
      </div>
      <div className="mt-auto flex items-end justify-between gap-2">
        <div className="min-w-0">
          {a ? (
            <>
              <p className="text-2xs text-fg-3">{a.currentCents ? t("currentBid") : t("startPrice")}</p>
              <p className="font-semibold text-fg-1">
                <ShortMoney cents={a.currentCents ?? a.startCents} />
              </p>
              <p className="text-2xs text-warn">
                ⏱ <Countdown target={Date.parse(a.endsAt)} />
                {a.myBidCents !== null && <span className="ml-1.5 text-gain">· {t("leading")}</span>}
              </p>
            </>
          ) : artwork.askCents !== null ? (
            <>
              <p className="text-2xs text-gain">{t("forSale")}</p>
              <p className="font-semibold text-fg-1">
                <ShortMoney cents={artwork.askCents} />
              </p>
              {artwork.offers > 0 && (
                <p className="text-2xs text-accent">{t("offersCount", { count: artwork.offers })}</p>
              )}
            </>
          ) : (
            <>
              <p className="text-2xs text-fg-3">{t("value")}</p>
              <p className="font-semibold text-fg-1">
                {artwork.valueCents !== null ? (
                  <ShortMoney cents={artwork.valueCents} />
                ) : (
                  <span className="text-fg-3">–</span>
                )}
              </p>
              {artwork.offers > 0 && (
                <p className="text-2xs text-accent">{t("offersCount", { count: artwork.offers })}</p>
              )}
            </>
          )}
        </div>
        <LikeButton artwork={artwork} />
      </div>
    </div>
  );
}
