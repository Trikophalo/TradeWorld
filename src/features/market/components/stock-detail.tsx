"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ViewTransition, useEffect, useMemo, useState } from "react";
import { SECTOR_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Delta } from "@/components/ui/delta";
import { EmptyState } from "@/components/ui/empty-state";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Segmented } from "@/components/ui/segmented";
import { DEMO_RANGES, demoSeries, type DemoCompany, type DemoRange } from "@/lib/demo/market";
import { useDemo } from "@/lib/demo/store";
import { PRICE_SCALE, formatMoney, formatPrice } from "@/lib/format";
import { useMountTime } from "@/lib/use-now";
import { Reveal } from "@/features/progression/components/reveal";
import { isTutorialActive } from "@/features/tutorial/store";
import { CompanyLogo } from "./company-logo";
import { OrderSheet, type OrderSide } from "./order-sheet";
import { PriceChart } from "./price-chart";

const format = (value: number) => formatPrice(Math.round(value));
const RANGE_OPTIONS = DEMO_RANGES.map((value) => ({ value, label: value }));

export function StockDetail({ company }: { company: DemoCompany }) {
  const t = useTranslations("markets");
  const to = useTranslations("order");
  const ts = useTranslations("sectors");
  const tt = useTranslations("tiers");
  const quote = useDemo((state) => state.quotes[company.ticker]);
  const price = quote?.priceE4 ?? company.priceE4;
  const change = quote?.changeBps ?? company.changeBps;
  const [range, setRange] = useState<DemoRange>("1T");
  const [order, setOrder] = useState<OrderSide | null>(null);
  const now = useMountTime();
  const anchor = now === null ? null : Math.floor(now / 1000);

  const data = useMemo(
    () => (anchor === null ? [] : demoSeries(company.ticker, company.priceE4 / PRICE_SCALE, range, anchor)),
    [company, range, anchor],
  );

  // Keyboard: B buys, S sells (desktop).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || isTutorialActive()) return;
      if (event.key.toLowerCase() === "b") setOrder("buy");
      if (event.key.toLowerCase() === "s") setOrder("sell");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stats = [
    { label: t("statMarketCap"), value: formatMoney(company.marketCapCents, { compact: true }) },
    { label: t("statSector"), value: ts(company.sector) },
    { label: t("statTier"), value: tt(company.tier) },
    { label: t("statPe"), value: null },
    { label: t("statDividend"), value: null },
    { label: t("statMargin"), value: null },
  ];

  return (
    <>
      <Link
        href="/markets"
        transitionTypes={["nav-back"]}
        className="-ml-2 inline-flex h-9 items-center gap-2 rounded-sm px-2 label-pixel text-fg-2 focus-ring transition-colors duration-fast hover:text-fg-1"
      >
        <svg viewBox="0 0 4 7" width="8" height="14" shapeRendering="crispEdges" aria-hidden>
          <path fill="currentColor" d="M3 0h1v1H3zM2 1h1v1H2zM1 2h1v1H1zM0 3h1v1H0zM1 4h1v1H1zM2 5h1v1H2zM3 6h1v1H3z" />
        </svg>
        {t("back")}
      </Link>

      <header className="flex items-center gap-4">
        <ViewTransition name={`logo-${company.ticker}`} share="morph" default="none">
          <CompanyLogo ticker={company.ticker} color={company.color} scale={4} />
        </ViewTransition>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold text-fg-1 lg:text-2xl">{company.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge>{company.ticker}</Badge>
            <Badge tone="accent">
              <PixelIcon {...SECTOR_ICONS[company.sector]} scale={1} />
              {ts(company.sector)}
            </Badge>
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        <Card padding="lg" className="self-start" data-tour="stock-price">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <NumberTicker value={price} format={format} flash className="text-3xl font-semibold text-fg-1" />
              <Delta bps={change} pill />
            </div>
            <Segmented value={range} onValueChange={setRange} options={RANGE_OPTIONS} label={t("range")} size="sm" />
          </div>
          <PriceChart
            data={data}
            positive={change >= 0}
            label={`${company.name}: ${formatPrice(price)}`}
            className="mt-4 h-64 lg:h-96"
          />
        </Card>

        <div className="space-y-5 lg:space-y-6">
          <Card padding="lg" className="hidden lg:block">
            <div className="grid grid-cols-2 gap-3">
              <Button variant="gain" size="lg" data-tour="buy" onClick={() => setOrder("buy")}>
                {t("buy")}
              </Button>
              <Button variant="loss" size="lg" onClick={() => setOrder("sell")}>
                {t("sell")}
              </Button>
            </div>
            <p className="mt-3 text-center text-xs text-fg-3">{to("shortcutHint")}</p>
          </Card>

          <Reveal feature="stockStats">
            <Card padding="lg">
              <CardHeader>
                <CardTitle>{t("stats")}</CardTitle>
              </CardHeader>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
                {stats.map((stat) => (
                  <div key={stat.label}>
                    <dt className="text-sm text-fg-3">{stat.label}</dt>
                    <dd className="mt-0.5 nums font-medium text-fg-1">
                      {stat.value ?? <span className="label-pixel text-fg-3">{t("statPending")}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          </Reveal>

          <Reveal feature="stockOrderBook">
            <Card padding="lg">
              <CardHeader>
                <CardTitle>{t("orderBook")}</CardTitle>
              </CardHeader>
              <EmptyState
                className="py-2"
                art={<PixelIcon {...SECTOR_ICONS[company.sector]} scale={4} />}
                title={t("orderBookEmptyTitle")}
                description={t("orderBookEmptyText")}
              />
            </Card>
          </Reveal>
        </div>
      </div>

      {/* Phones: thumb-reachable actions above the tab bar. */}
      <div className="fixed inset-x-0 bottom-[calc(var(--tabbar-height)+var(--safe-bottom))] z-sticky grid grid-cols-2 gap-3 border-t border-line-1 bg-bg/92 px-4 py-3 backdrop-blur-lg lg:hidden">
        <Button variant="gain" data-tour="buy" onClick={() => setOrder("buy")}>
          {t("buy")}
        </Button>
        <Button variant="loss" onClick={() => setOrder("sell")}>
          {t("sell")}
        </Button>
      </div>
      <div aria-hidden className="h-16 lg:hidden" />

      <OrderSheet company={company} side={order} priceE4={price} onClose={() => setOrder(null)} />
    </>
  );
}
