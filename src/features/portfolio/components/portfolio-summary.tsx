"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { NumberTicker } from "@/components/ui/number-ticker";
import { useDemo } from "@/lib/demo/store";
import { formatMoney } from "@/lib/format";
import { fadeUp, staggerContainer } from "@/lib/motion";

const format = (value: number) => formatMoney(Math.round(value));

export function PortfolioSummary() {
  const t = useTranslations("portfolio");
  const cash = useDemo((state) => state.cashCents);
  const items = [
    { label: t("total"), value: cash, large: true },
    { label: t("cash"), value: cash },
    { label: t("invested"), value: 0 },
  ];
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      data-tour="portfolio-summary"
      className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-6"
    >
      {items.map((item) => (
        <motion.div key={item.label} variants={fadeUp} className={item.large ? "col-span-2 lg:col-span-1" : undefined}>
          <Card padding="lg" className="h-full">
            <p className="label-pixel text-fg-3">{item.label}</p>
            <NumberTicker
              value={item.value}
              format={format}
              className={item.large ? "mt-1 text-3xl font-semibold text-fg-1" : "mt-1 text-xl font-semibold text-fg-1"}
            />
          </Card>
        </motion.div>
      ))}
    </motion.div>
  );
}
