"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Fragment, useState } from "react";
import { BULL } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Delta } from "@/components/ui/delta";
import { EmptyState } from "@/components/ui/empty-state";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Segmented } from "@/components/ui/segmented";
import { SkeletonRow } from "@/components/ui/skeleton";
import { useGame } from "@/features/game/store";
import { brandColor } from "@/features/market/brand";
import { CompanyLogo } from "@/features/market/components/company-logo";
import { formatMoney, formatPrice, formatShares } from "@/lib/format";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

const money = (value: number) => formatMoney(Math.round(value));

/** Everything the player owns, with value and profit or loss. */
export function PositionsList() {
  const t = useTranslations("portfolio");
  const ts = useTranslations("sectors");
  const all = useGame((state) => state.portfolio?.positions);
  const byTicker = useGame((state) => state.byTicker);
  const [sort, setSort] = useState<"value" | "sector">("value");
  // Sector of a position from the market list; bonds and coins have none and come last.
  const sectorOf = (ticker: string) => byTicker[ticker]?.sector ?? null;
  const sectorName = (ticker: string) => {
    const sector = sectorOf(ticker);
    return sector ? ts(sector) : t("sectorOther");
  };
  const positions =
    all === undefined || sort === "value"
      ? all
      : [...all].sort(
          (a, b) =>
            Number(sectorOf(a.ticker) === null) - Number(sectorOf(b.ticker) === null) ||
            sectorName(a.ticker).localeCompare(sectorName(b.ticker)) ||
            b.marketValueCents - a.marketValueCents,
        );

  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle>{t("positions")}</CardTitle>
        {(all?.length ?? 0) > 1 && (
          <Segmented
            value={sort}
            onValueChange={setSort}
            label={t("sortLabel")}
            size="sm"
            options={[
              { value: "value", label: t("sortValue") },
              { value: "sector", label: t("sortSector") },
            ]}
          />
        )}
      </CardHeader>
      {positions === undefined && (
        <>
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {positions?.length === 0 && (
        <EmptyState
          art={<PixelIcon {...BULL} scale={4} />}
          title={t("emptyTitle")}
          description={t("emptyText")}
          action={
            <Link href="/markets" className={buttonVariants()}>
              {t("emptyAction")}
            </Link>
          }
        />
      )}
      <ul>
        <AnimatePresence initial={false}>
          {positions?.map((p, i) => {
            const pnlBps = p.costBasisCents ? Math.round((p.unrealizedPnlCents / p.costBasisCents) * 10_000) : 0;
            const heading =
              sort === "sector" && (i === 0 || sectorName(positions[i - 1]!.ticker) !== sectorName(p.ticker))
                ? sectorName(p.ticker)
                : null;
            return (
              <Fragment key={p.ticker}>
                {heading && (
                  <li className="mt-3 mb-1 label-pixel text-fg-3 first:mt-0" data-sector-heading>
                    {heading}
                  </li>
                )}
                <motion.li
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={SPRING.smooth}
                >
                  <Link
                    href={
                      p.kind === "stock"
                        ? `/markets/${p.ticker}`
                        : p.kind === "crypto"
                          ? `/crypto/${p.ticker}`
                          : "/markets"
                    }
                    className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 focus-ring transition-colors duration-fast hover:bg-surface-2"
                  >
                    <CompanyLogo ticker={p.ticker} color={brandColor(p.ticker)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-fg-1">{p.name}</span>
                      <span className="nums text-sm text-fg-3">
                        {t("positionLine", { quantity: formatShares(p.quantityE6), price: formatPrice(p.avgPriceE4) })}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-0.5">
                      <NumberTicker value={p.marketValueCents} format={money} className="font-semibold text-fg-1" />
                      <span
                        className={cn(
                          "flex items-center gap-1.5 nums text-sm",
                          p.unrealizedPnlCents >= 0 ? "text-gain" : "text-loss",
                        )}
                      >
                        {formatMoney(p.unrealizedPnlCents, { sign: true })}
                        <Delta bps={pnlBps} className="text-xs" />
                      </span>
                    </span>
                  </Link>
                </motion.li>
              </Fragment>
            );
          })}
        </AnimatePresence>
      </ul>
    </Card>
  );
}
