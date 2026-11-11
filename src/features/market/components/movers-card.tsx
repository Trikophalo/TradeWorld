"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { useSecurities } from "@/features/game/hooks";
import { SPRING } from "@/lib/motion";
import { SecurityRow, SecurityRowSkeleton } from "./security-row";

type Side = "gainers" | "losers";

/** Top gainers and losers. Rows reorder with a layout animation when ranks change. */
export function MoversCard() {
  const t = useTranslations("home");
  const [side, setSide] = useState<Side>("gainers");
  const stocks = useSecurities("stock");

  const rows = useMemo(() => {
    if (!stocks) return null;
    const sorted = [...stocks].sort((a, b) => b.changeBps - a.changeBps);
    return (side === "gainers" ? sorted : sorted.reverse()).slice(0, 5).map((s) => s.ticker);
  }, [stocks, side]);

  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle>{t("movers")}</CardTitle>
        <Segmented
          value={side}
          onValueChange={setSide}
          label={t("movers")}
          size="sm"
          options={[
            { value: "gainers", label: t("gainers") },
            { value: "losers", label: t("losers") },
          ]}
        />
      </CardHeader>
      <ul>
        <AnimatePresence mode="popLayout" initial={false}>
          {rows === null && Array.from({ length: 5 }, (_, i) => <SecurityRowSkeleton key={i} />)}
          {rows?.map((ticker) => (
            <motion.li
              key={ticker}
              layout
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={SPRING.smooth}
            >
              <SecurityRow ticker={ticker} shared={false} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </Card>
  );
}
