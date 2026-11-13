"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Delta } from "@/components/ui/delta";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { engine } from "@/features/game/store";
import type { Candle } from "@/features/game/types";
import { PriceChart } from "@/features/market/components/price-chart";
import { formatMoney } from "@/lib/format";

type Range = "day" | "week";
const HOURS: Record<Range, number> = { day: 24, week: 168 };

/** The own net worth over a day or a week (ADR-124), drawn like a price chart. */
export function NetWorthChart() {
  const t = useTranslations("portfolio");
  const [range, setRange] = useState<Range>("day");
  const history = useQuery({
    queryKey: ["net-worth-history", range],
    queryFn: () => engine.netWorthHistory(HOURS[range]),
    refetchInterval: 5 * 60_000,
  });
  const points = history.data;
  // Net worth in cents drawn as a "price": 1 cent = 100 in the chart's e4 scale.
  const candles: Candle[] | undefined = points?.map((p) => {
    const e4 = p.netWorthCents * 100;
    return { time: Math.floor(Date.parse(p.at) / 1000), open: e4, high: e4, low: e4, close: e4, volume: 0 };
  });
  const first = points?.[0]?.netWorthCents ?? 0;
  const last = points?.at(-1)?.netWorthCents ?? 0;
  const changeBps = first > 0 ? Math.round(((last - first) / first) * 10_000) : 0;
  const rangeLabel = range === "day" ? t("chartDay") : t("chartWeek");

  return (
    <Card padding="lg" data-testid="net-worth-chart">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{t("chartTitle")}</CardTitle>
          {points && points.length > 1 && (
            <p className="mt-1 flex flex-wrap items-center gap-2 nums text-sm text-fg-2">
              <span className="font-semibold text-fg-1">{formatMoney(last)}</span>
              <Delta bps={changeBps} />
            </p>
          )}
        </div>
        <Segmented
          value={range}
          onValueChange={setRange}
          label={t("chartRange")}
          size="sm"
          options={[
            { value: "day", label: t("chartDay") },
            { value: "week", label: t("chartWeek") },
          ]}
        />
      </CardHeader>
      {!points ? (
        <Skeleton className="h-56 w-full rounded-md" />
      ) : points.length < 2 ? (
        <p className="py-10 text-center text-sm text-pretty text-fg-3">{t("chartEmpty")}</p>
      ) : (
        <PriceChart
          candles={candles}
          positive={last >= first}
          label={t("chartLabel", { range: rangeLabel, value: formatMoney(last) })}
          className="h-56"
        />
      )}
    </Card>
  );
}
