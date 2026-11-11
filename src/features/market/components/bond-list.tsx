"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { COIN } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SkeletonRow } from "@/components/ui/skeleton";
import { useSecurities } from "@/features/game/hooks";
import { useGame } from "@/features/game/store";
import { formatBps, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OrderSheet, type OrderSide } from "./order-sheet";

const plainPercent = (bps: number) => formatBps(bps).replace(/^\+/, "");

/**
 * Government bonds: the safe option. Before the unlock the list is visible
 * but dimmed, so the player knows what is coming.
 */
export function BondList({ locked }: { locked: boolean }) {
  const t = useTranslations("markets");
  const bonds = useSecurities("bond");
  const held = useGame((state) => state.portfolio?.positions);
  // The sheet stays mounted with the last ticker, so it can animate out.
  const [order, setOrder] = useState<{ ticker: string; side: OrderSide | null }>({ ticker: "", side: null });

  return (
    <Card padding="lg" className={cn(locked && "opacity-60")} aria-disabled={locked || undefined}>
      <p className="mb-3 text-sm text-pretty text-fg-2">{t("bondsIntro")}</p>
      <ul className="divide-y divide-line-1">
        {bonds === null && Array.from({ length: 4 }, (_, i) => <SkeletonRow key={i} />)}
        {bonds?.map((bond) => {
          const quantity = held?.find((p) => p.ticker === bond.ticker)?.quantity ?? 0;
          return (
            <li key={bond.ticker} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-2">
                <PixelIcon {...COIN} scale={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-fg-1">{bond.name}</span>
                <span className="label-pixel text-fg-3">
                  {bond.ticker}
                  {quantity > 0 && ` · ${t("bondsHeld", { count: quantity })}`}
                </span>
              </span>
              <span className="flex flex-col items-end nums">
                <span className="font-semibold text-gain">
                  {t("bondsYield", { yield: plainPercent(bond.bond?.yieldBps ?? 0) })}
                </span>
                <span className="text-sm text-fg-3">{formatPrice(bond.askE4)}</span>
              </span>
              {!locked && (
                <div className="flex w-full gap-2 sm:w-auto">
                  <Button
                    size="sm"
                    variant="gain"
                    className="flex-1"
                    onClick={() => setOrder({ ticker: bond.ticker, side: "buy" })}
                  >
                    {t("buy")}
                  </Button>
                  {quantity > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1"
                      onClick={() => setOrder({ ticker: bond.ticker, side: "sell" })}
                    >
                      {t("sell")}
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <OrderSheet ticker={order.ticker} side={order.side} onClose={() => setOrder((o) => ({ ...o, side: null }))} />
    </Card>
  );
}
