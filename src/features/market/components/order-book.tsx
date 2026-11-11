"use client";

import { useTranslations } from "next-intl";
import { SkeletonRow } from "@/components/ui/skeleton";
import { useOrderBook } from "@/features/game/hooks";
import type { BookLevel } from "@/features/game/types";
import { formatInteger, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Best bids and asks. Depth bars scale with the quantity and grow from the
 * middle; levels that contain limit orders of players carry a marker.
 */
export function OrderBook({ ticker }: { ticker: string }) {
  const t = useTranslations("markets");
  const book = useOrderBook(ticker);

  if (!book.data) {
    return (
      <div>
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }
  const max = Math.max(1, ...book.data.bids.map((l) => l.quantity), ...book.data.asks.map((l) => l.quantity));
  const spread = (book.data.asks[0]?.priceE4 ?? 0) - (book.data.bids[0]?.priceE4 ?? 0);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 label-pixel text-fg-3">
        <span>{t("bookBid")}</span>
        <span className="text-right">{t("bookAsk")}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <Side levels={book.data.bids} max={max} side="bid" playerLabel={t("bookPlayers")} />
        <Side levels={book.data.asks} max={max} side="ask" playerLabel={t("bookPlayers")} />
      </div>
      {spread > 0 && (
        <p className="mt-3 text-center text-xs text-fg-3">{t("bookSpread", { spread: formatPrice(spread) })}</p>
      )}
    </div>
  );
}

function Side({
  levels,
  max,
  side,
  playerLabel,
}: {
  levels: BookLevel[];
  max: number;
  side: "bid" | "ask";
  playerLabel: string;
}) {
  return (
    <ul className="space-y-1">
      {levels.map((level) => (
        <li
          key={level.priceE4}
          className={cn(
            "relative flex h-7 items-center justify-between gap-2 overflow-hidden rounded-xs px-2 text-sm",
            side === "ask" && "flex-row-reverse",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "absolute inset-y-0 w-full transition-transform duration-slow ease-out",
              side === "bid" ? "right-0 origin-right bg-gain-soft" : "left-0 origin-left bg-loss-soft",
            )}
            style={{ transform: `scaleX(${level.quantity / max})` }}
          />
          <span className={cn("relative nums font-medium", side === "bid" ? "text-gain" : "text-loss")}>
            {formatPrice(level.priceE4)}
          </span>
          <span className="relative flex items-center gap-1.5 nums text-fg-2">
            {level.players > 0 && <span title={playerLabel} className="size-1.5 bg-accent" />}
            {formatInteger(level.quantity)}
          </span>
        </li>
      ))}
    </ul>
  );
}
