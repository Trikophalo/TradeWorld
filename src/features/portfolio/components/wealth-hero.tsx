"use client";

import { useTranslations } from "next-intl";
import { Delta } from "@/components/ui/delta";
import { NumberTicker } from "@/components/ui/number-ticker";
import { useDemo } from "@/lib/demo/store";
import { formatMoney } from "@/lib/format";

const format = (value: number) => formatMoney(Math.round(value));

/** The big number at the top of the start page. */
export function WealthHero() {
  const t = useTranslations("home");
  const cash = useDemo((state) => state.cashCents);
  return (
    <section aria-label={t("portfolioValue")}>
      <p className="label-pixel text-fg-3">{t("portfolioValue")}</p>
      <NumberTicker value={cash} format={format} className="mt-1 text-4xl font-semibold tracking-tight text-fg-1" />
      <p className="mt-1.5 flex items-center gap-2 text-sm text-fg-3">
        <Delta bps={0} pill />
        {t("today")}
      </p>
    </section>
  );
}
