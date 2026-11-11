"use client";

import { useTranslations } from "next-intl";
import { Delta } from "@/components/ui/delta";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Skeleton } from "@/components/ui/skeleton";
import { BALANCE } from "@/config/balance";
import { useGame } from "@/features/game/store";
import { formatMoney } from "@/lib/format";

const format = (value: number) => formatMoney(Math.round(value));

/** The big number at the top of the start page: total wealth and the change since the start. */
export function WealthHero() {
  const t = useTranslations("home");
  const total = useGame((state) => state.portfolio?.totalCents);
  const start = BALANCE.economy.startingCapitalCents;
  return (
    <section aria-label={t("portfolioValue")} data-tour="wealth" className="w-fit">
      <p className="label-pixel text-fg-3">{t("portfolioValue")}</p>
      {total === undefined ? (
        <Skeleton className="mt-2 h-10 w-56" />
      ) : (
        <NumberTicker value={total} format={format} className="mt-1 text-4xl font-semibold tracking-tight text-fg-1" />
      )}
      <p className="mt-1.5 flex items-center gap-2 text-sm text-fg-3">
        <Delta bps={total === undefined ? 0 : Math.round((total / start - 1) * 10_000)} pill />
        {t("sinceStart")}
      </p>
    </section>
  );
}
