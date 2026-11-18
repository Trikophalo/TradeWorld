"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WEALTH_PARTS, type NetWorthBreakdown as Breakdown } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMyNetWorth } from "../hooks";

const money = (cents: number) => formatMoney(cents, { whole: true });

/**
 * The own net worth in parts (ADR-203): every part the rich list counts, with the sum. Parts that are 0 stay
 * hidden; the bars show each positive part's share of everything owned.
 */
export function NetWorthBreakdownCard() {
  const data = useMyNetWorth().data;
  return <NetWorthBreakdownView data={data} />;
}

export function NetWorthBreakdownView({ data }: { data: Breakdown | undefined }) {
  const t = useTranslations("ranking");
  const tb = useTranslations("ranking.basis");
  const gross = data ? WEALTH_PARTS.reduce((sum, key) => sum + Math.max(0, data.parts[key]), 0) : 0;
  const shown = data ? WEALTH_PARTS.filter((key) => data.parts[key] !== 0) : [];
  return (
    <Card padding="lg" data-testid="net-worth-breakdown">
      <h2 className="label-pixel text-fg-2">{t("breakdownTitle")}</h2>
      {!data ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      ) : (
        <>
          <dl className="mt-3 space-y-2">
            {shown.map((key) => {
              const cents = data.parts[key];
              return (
                <div key={key} data-part={key}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <dt className="min-w-0 truncate text-fg-2">{t(`parts.${key}`)}</dt>
                    <dd className={cn("shrink-0 nums font-medium", cents < 0 ? "text-loss" : "text-fg-1")}>
                      {money(cents)}
                    </dd>
                  </div>
                  {cents > 0 && gross > 0 && (
                    <span aria-hidden className="mt-1 block h-1 overflow-hidden rounded-pill bg-surface-3">
                      <span
                        className="block h-full origin-left rounded-pill bg-accent motion-safe:transition-transform motion-safe:duration-slow motion-safe:ease-out"
                        style={{ transform: `scaleX(${Math.min(1, cents / gross)})` }}
                      />
                    </span>
                  )}
                </div>
              );
            })}
          </dl>
          <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-line-1 pt-3">
            <span className="font-semibold text-fg-1">{t("breakdownTotal")}</span>
            <span className="nums text-lg font-semibold text-fg-1" data-testid="net-worth-total">
              {money(data.totalCents)}
            </span>
          </p>
          {data.company && (
            <p className="mt-2 text-xs text-pretty text-fg-3">
              {t("breakdownCompany", {
                name: data.company.name,
                basis: tb(data.company.basis),
                amount: money(data.company.cents),
              })}
            </p>
          )}
          <p className="mt-2 text-xs text-pretty text-fg-3">{t("breakdownHint")}</p>
          <p className="mt-1 text-xs text-pretty text-fg-3">{t("breakdownLeague")}</p>
        </>
      )}
    </Card>
  );
}
