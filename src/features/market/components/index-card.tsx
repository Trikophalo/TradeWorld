"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Delta } from "@/components/ui/delta";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Segmented } from "@/components/ui/segmented";
import { DEMO_RANGES, demoSeries, type DemoRange } from "@/lib/demo/market";
import { useDemo } from "@/lib/demo/store";
import { useMountTime } from "@/lib/use-now";
import { PriceChart } from "./price-chart";

const points = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const format = (value: number) => points.format(value);
const RANGE_OPTIONS = DEMO_RANGES.map((value) => ({ value, label: value }));

/** Lead index with chart and time-range switch. */
export function IndexCard() {
  const t = useTranslations("home");
  const tm = useTranslations("markets");
  const [range, setRange] = useState<DemoRange>("1T");
  const level = useDemo((state) => state.indexPoints);
  const change = useDemo((state) => state.indexChangeBps);
  const now = useMountTime();
  const anchor = now === null ? null : Math.floor(now / 1000);
  // The curve is rebuilt per range, not per tick: live points arrive in M1.
  const data = useMemo(
    () => (anchor === null ? [] : demoSeries("NEXA30", useDemo.getState().indexPoints, range, anchor)),
    [range, anchor],
  );

  return (
    <Card padding="lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="label-pixel text-fg-2">{t("indexTitle")}</h2>
          <div className="mt-1 flex items-baseline gap-2.5">
            <NumberTicker value={level} format={format} flash className="text-2xl font-semibold text-fg-1" />
            <Delta bps={change} />
          </div>
        </div>
        <Segmented value={range} onValueChange={setRange} options={RANGE_OPTIONS} label={tm("range")} size="sm" />
      </div>
      <PriceChart
        data={data}
        positive={change >= 0}
        label={`${t("indexTitle")}: ${format(level)} ${t("indexPoints")}`}
        className="mt-4 h-56 lg:h-72"
      />
    </Card>
  );
}
