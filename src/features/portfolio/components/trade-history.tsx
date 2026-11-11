"use client";

import { useTranslations } from "next-intl";
import { COIN } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useGame } from "@/features/game/store";
import { formatMoney, formatPrice, formatShares } from "@/lib/format";
import { cn } from "@/lib/utils";

const dateTime = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** Every execution with fee and tax, newest first. Also shows the loss pot. */
export function TradeHistory() {
  const t = useTranslations("portfolio");
  const trades = useGame((state) => state.portfolio?.recentTrades);
  const lossPot = useGame((state) => state.portfolio?.lossPotCents ?? 0);

  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle>{t("history")}</CardTitle>
        {lossPot > 0 && (
          <span className="nums text-sm text-fg-3">{t("lossPot", { amount: formatMoney(lossPot) })}</span>
        )}
      </CardHeader>
      {trades && trades.length === 0 ? (
        <EmptyState
          className="py-4"
          art={<PixelIcon {...COIN} scale={4} />}
          title={t("historyEmptyTitle")}
          description={t("historyEmptyText")}
        />
      ) : (
        <ul className="divide-y divide-line-1">
          {trades?.map((trade) => (
            <li key={trade.id} className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-fg-1">
                  {t(trade.side === "buy" ? "sideBuy" : "sideSell")} {trade.ticker}
                </span>
                <span className={cn("nums font-medium", trade.side === "buy" ? "text-fg-1" : "text-gain")}>
                  {trade.side === "buy" ? "−" : "+"}
                  {formatMoney(
                    trade.side === "buy"
                      ? trade.grossCents + trade.feeCents
                      : trade.grossCents - trade.feeCents - trade.taxCents,
                  )}
                </span>
              </div>
              <p className="mt-0.5 nums text-sm text-fg-3">
                {dateTime.format(new Date(trade.executedAt))} ·{" "}
                {t("tradeLine", { quantity: formatShares(trade.quantityE6, true), price: formatPrice(trade.priceE4) })}{" "}
                · {t("fee", { fee: formatMoney(trade.feeCents) })}
                {trade.taxCents > 0 && ` · ${t("tax", { tax: formatMoney(trade.taxCents) })}`}
                {trade.realizedPnlCents != null &&
                  ` · ${t("realized", { pnl: formatMoney(trade.realizedPnlCents, { sign: true }) })}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
