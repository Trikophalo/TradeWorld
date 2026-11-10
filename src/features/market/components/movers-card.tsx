"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { DEMO_COMPANIES } from "@/lib/demo/market";
import { useDemo } from "@/lib/demo/store";
import { SPRING } from "@/lib/motion";
import { SecurityRow } from "./security-row";

type Side = "gainers" | "losers";

/** Top gainers and losers. Rows reorder with a layout animation when ranks change. */
export function MoversCard() {
  const t = useTranslations("home");
  const [side, setSide] = useState<Side>("gainers");
  const quotes = useDemo((state) => state.quotes);

  const rows = useMemo(() => {
    const sorted = [...DEMO_COMPANIES].sort(
      (a, b) => (quotes[b.ticker]?.changeBps ?? b.changeBps) - (quotes[a.ticker]?.changeBps ?? a.changeBps),
    );
    return (side === "gainers" ? sorted : sorted.reverse()).slice(0, 5);
  }, [quotes, side]);

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
          {rows.map((company) => (
            <motion.li
              key={company.ticker}
              layout
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={SPRING.smooth}
            >
              <SecurityRow company={company} shared={false} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </Card>
  );
}
