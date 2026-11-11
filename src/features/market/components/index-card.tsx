"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Delta } from "@/components/ui/delta";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART_RANGES, useCandles, useSecurities, type ChartRange } from "@/features/game/hooks";
import { useGame } from "@/features/game/store";
import { PRICE_SCALE } from "@/lib/format";
import { PriceChart } from "./price-chart";
import { SecurityRow } from "./security-row";

const points = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const format = (value: number) => points.format(value / PRICE_SCALE);
const RANGE_OPTIONS = CHART_RANGES.map((value) => ({ value, label: value }));

/** Lead index with live chart and time-range switch. `showMembers` lists its constituents. */
export function IndexCard({ showMembers = false }: { showMembers?: boolean }) {
  const t = useTranslations("home");
  const tm = useTranslations("markets");
  const [range, setRange] = useState<ChartRange>("1T");
  const index = useGame((state) => state.snapshot?.index);
  const candles = useCandles(index?.ticker ?? "NEXA30", range);
  const stocks = useSecurities("stock");
  const members = stocks ? [...stocks].sort((a, b) => (b.marketCapCents ?? 0) - (a.marketCapCents ?? 0)) : [];

  return (
    <Card padding="lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="label-pixel text-fg-2">{index?.name ?? t("indexTitle")}</h2>
          {index ? (
            <div className="mt-1 flex items-baseline gap-2.5">
              <NumberTicker value={index.valueE4} format={format} flash className="text-2xl font-semibold text-fg-1" />
              <Delta bps={index.changeBps} />
            </div>
          ) : (
            <Skeleton className="mt-2 h-7 w-40" />
          )}
        </div>
        <Segmented value={range} onValueChange={setRange} options={RANGE_OPTIONS} label={tm("range")} size="sm" />
      </div>
      <PriceChart
        candles={candles.data}
        liveE4={index?.valueE4}
        positive={(index?.changeBps ?? 0) >= 0}
        label={index ? `${index.name}: ${format(index.valueE4)} ${t("indexPoints")}` : t("indexTitle")}
        className="mt-4 h-56 lg:h-72"
      />
      {showMembers && members.length > 0 && (
        <div className="mt-6">
          <CardHeader>
            <CardTitle>{tm("indexMembers", { count: members.length })}</CardTitle>
          </CardHeader>
          <p className="-mt-2 mb-2 text-sm text-fg-3">{tm("indexMembersHint")}</p>
          <ul className="lg:grid lg:grid-cols-2 lg:gap-x-10">
            {members.map((m) => (
              <li key={m.ticker}>
                <SecurityRow ticker={m.ticker} shared={false} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
