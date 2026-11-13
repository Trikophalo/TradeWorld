"use client";

import { useTranslations } from "next-intl";
import { CHESTS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
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
  // Wealth includes the own company (ADR-057), like on the rich list.
  const total = useGame((state) =>
    state.portfolio
      ? state.portfolio.totalCents + state.portfolio.companyValueCents - state.portfolio.debtCents
      : undefined,
  );
  const start = BALANCE.economy.startingCapitalCents;
  return (
    <section
      aria-label={t("portfolioValue")}
      data-tour="wealth"
      className="relative isolate overflow-hidden rounded-lg border-2 border-line-1 bg-surface-1 shadow-1"
    >
      <span aria-hidden className="absolute inset-0 -z-10 bg-hero" />
      {/* A slow gleam runs over the treasure every few seconds (ADR-108). */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 -z-10 w-1/5 animate-sheen bg-shine opacity-25"
      />
      <div className="flex items-center gap-4 px-4 py-4 lg:px-6 lg:py-5">
        <div className="min-w-0 flex-1">
          <p className="label-pixel text-fg-3">{t("portfolioValue")}</p>
          {total === undefined ? (
            <Skeleton className="mt-2 h-10 w-56" />
          ) : (
            <NumberTicker
              value={total}
              format={format}
              className="mt-1 block text-3xl font-semibold tracking-tight text-fg-1 sm:text-4xl"
            />
          )}
          <p className="mt-1.5 flex items-center gap-2 text-sm text-fg-3">
            <Delta bps={total === undefined ? 0 : Math.round((total / start - 1) * 10_000)} pill />
            {t("sinceStart")}
          </p>
        </div>
        <span aria-hidden className="relative mr-1 shrink-0 lg:mr-3">
          <span className="block animate-float">
            <PixelIcon {...CHESTS.gold.open} scale={3} className="sm:hidden" />
            <PixelIcon {...CHESTS.gold.open} scale={4} className="hidden sm:block" />
          </span>
          <span className="absolute inset-x-2 -bottom-2 h-1 rounded-pill bg-edge opacity-60" />
          <span className="absolute -top-1 -left-2 size-[3px] animate-twinkle bg-gold" />
          <span className="absolute top-3 -right-2 size-[3px] animate-twinkle bg-gold [animation-delay:0.9s]" />
        </span>
      </div>
    </section>
  );
}
