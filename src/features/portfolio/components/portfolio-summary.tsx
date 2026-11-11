"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Skeleton } from "@/components/ui/skeleton";
import { useGame } from "@/features/game/store";
import { formatMoney } from "@/lib/format";
import { fadeUp, staggerContainer } from "@/lib/motion";

const format = (value: number) => formatMoney(Math.round(value));

export function PortfolioSummary() {
  const t = useTranslations("portfolio");
  const portfolio = useGame((state) => state.portfolio);
  const items = portfolio
    ? [
        { label: t("total"), value: portfolio.totalCents, large: true },
        { label: t("cash"), value: portfolio.cashCents + portfolio.reservedCents },
        { label: t("invested"), value: portfolio.positionsValueCents },
      ]
    : null;

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      data-tour="portfolio-summary"
      className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-6"
    >
      {(items ?? [null, null, null]).map((item, index) => (
        <motion.div key={index} variants={fadeUp} className={index === 0 ? "col-span-2 lg:col-span-1" : undefined}>
          <Card padding="lg" className="h-full">
            {item ? (
              <>
                <p className="label-pixel text-fg-3">{item.label}</p>
                <NumberTicker
                  value={item.value}
                  format={format}
                  className={
                    item.large ? "mt-1 text-3xl font-semibold text-fg-1" : "mt-1 text-xl font-semibold text-fg-1"
                  }
                />
              </>
            ) : (
              <>
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-3 h-7 w-32" />
              </>
            )}
          </Card>
        </motion.div>
      ))}
    </motion.div>
  );
}
