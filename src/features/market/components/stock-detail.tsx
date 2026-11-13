"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ViewTransition, useEffect, useState } from "react";
import { BEAR, SECTOR_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Delta } from "@/components/ui/delta";
import { EmptyState } from "@/components/ui/empty-state";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART_RANGES, useCandles, useSecurityDetails, type ChartRange } from "@/features/game/hooks";
import { useGame, useMarketReady, useSecurity } from "@/features/game/store";
import { Reveal } from "@/features/progression/components/reveal";
import { isTutorialActive } from "@/features/tutorial/store";
import { formatBps, formatMoney, formatPrice, formatShares } from "@/lib/format";
import { useSettings } from "@/stores/settings";
import { cn } from "@/lib/utils";
import { brandColor } from "../brand";
import { CompanyLogo } from "./company-logo";
import { OrderBook } from "./order-book";
import { OrderSheet, type OrderSide } from "./order-sheet";
import { PriceChart } from "./price-chart";

const format = (value: number) => formatPrice(Math.round(value));
const RANGE_OPTIONS = CHART_RANGES.map((value) => ({ value, label: value }));
const plainPercent = (bps: number) => formatBps(bps).replace(/^\+/, "");
const dateTime = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function StockDetail({ ticker }: { ticker: string }) {
  const t = useTranslations("markets");
  const to = useTranslations("order");
  const ts = useTranslations("sectors");
  const tt = useTranslations("tiers");
  const ready = useMarketReady();
  const tc = useTranslations("companyProfile");
  const security = useSecurity(ticker);
  const position = useGame((state) => state.portfolio?.positions.find((p) => p.ticker === ticker));
  const [range, setRange] = useState<ChartRange>("1T");
  const chartStyle = useSettings((state) => (state.chartStyle === "candles" ? "candles" : "area"));
  const setSetting = useSettings((state) => state.set);
  const [order, setOrder] = useState<OrderSide | null>(null);
  const candles = useCandles(ticker, range);
  const details = useSecurityDetails(ticker);

  // Counts for "look at 3 stocks" style quick missions.
  const track = useGame((state) => state.track);
  useEffect(() => {
    if (security) track("view_security", ticker);
    // Only once per page visit, not on every price tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, security !== undefined, track]);

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

  if (ready && !security) {
    return (
      <EmptyState
        art={<PixelIcon {...BEAR} scale={4} />}
        title={t("notFoundTitle")}
        description={t("notFoundText")}
        action={
          <Link href="/markets" className={buttonVariants({ variant: "secondary" })}>
            {t("back")}
          </Link>
        }
      />
    );
  }

  const d = details.data;
  const stats = [
    {
      label: t("statMarketCap"),
      value: security?.marketCapCents ? formatMoney(security.marketCapCents, { compact: true }) : null,
    },
    { label: t("statSector"), value: security?.sector ? ts(security.sector) : null },
    { label: t("statTier"), value: security?.sizeClass ? tt(security.sizeClass) : null },
    {
      label: t("statPe"),
      value: d?.peX100 ? (d.peX100 / 100).toLocaleString("de-DE", { maximumFractionDigits: 1 }) : null,
    },
    { label: t("statDividend"), value: d?.dividendYieldBps != null ? plainPercent(d.dividendYieldBps) : null },
    { label: t("statMargin"), value: d?.marginBps != null ? plainPercent(d.marginBps) : null },
    { label: t("statRevenue"), value: d?.revenueCents != null ? formatMoney(d.revenueCents, { compact: true }) : null },
    {
      label: t("statDayRange"),
      value: security ? `${formatPrice(security.dayLowE4)} – ${formatPrice(security.dayHighE4)}` : null,
    },
  ];
  const held = position ? position.quantityE6 : 0;

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
        <ViewTransition name={`logo-${ticker}`} share="morph" default="none">
          <CompanyLogo ticker={ticker} color={brandColor(ticker)} scale={4} />
        </ViewTransition>
        <div className="min-w-0 flex-1">
          {security ? (
            <h1 className="truncate text-xl font-semibold text-fg-1 lg:text-2xl">{security.name}</h1>
          ) : (
            <Skeleton className="h-7 w-48" />
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge>{ticker}</Badge>
            {security?.companyId && (
              <Link
                href={`/companies/${encodeURIComponent(security.companyId)}`}
                className="label-pixel text-accent focus-ring hover:underline"
                data-testid="open-company"
              >
                {tc("open")}
              </Link>
            )}
            {security?.sector && (
              <Badge tone="accent">
                <PixelIcon {...SECTOR_ICONS[security.sector]} scale={1} />
                {ts(security.sector)}
              </Badge>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        <div className="space-y-5 lg:space-y-6">
          <Card padding="lg" data-tour="stock-price">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex items-baseline gap-3">
                {security ? (
                  <>
                    <NumberTicker
                      value={security.lastE4}
                      format={format}
                      flash
                      className="text-3xl font-semibold text-fg-1"
                    />
                    <Delta bps={security.changeBps} pill />
                  </>
                ) : (
                  <Skeleton className="h-9 w-40" />
                )}
              </div>
              <div className="flex items-center gap-2">
                <Segmented
                  value={chartStyle}
                  onValueChange={(value) => setSetting("chartStyle", value === "candles" ? "candles" : "area")}
                  options={[
                    { value: "area", label: t("chartLine") },
                    { value: "candles", label: t("chartCandles") },
                  ]}
                  label={t("chartStyle")}
                  size="sm"
                />
                <Segmented
                  value={range}
                  onValueChange={setRange}
                  options={RANGE_OPTIONS}
                  label={t("range")}
                  size="sm"
                />
              </div>
            </div>
            <PriceChart
              candles={candles.data}
              liveE4={security?.lastE4}
              chartStyle={chartStyle}
              positive={(security?.changeBps ?? 0) >= 0}
              label={security ? `${security.name}: ${formatPrice(security.lastE4)}` : ticker}
              className="mt-4 h-64 lg:h-96"
            />
            {security && (
              <p className="mt-3 flex flex-wrap justify-between gap-2 nums text-sm text-fg-3">
                <span>{t("bidAsk", { bid: formatPrice(security.bidE4), ask: formatPrice(security.askE4) })}</span>
                <span>{t("volume", { volume: formatShares(security.dayVolumeE6) })}</span>
              </p>
            )}
          </Card>

          <Card padding="lg">
            <CardHeader>
              <CardTitle>{t("news")}</CardTitle>
            </CardHeader>
            {d && d.news.length > 0 ? (
              <ul className="divide-y divide-line-1">
                {d.news.map((item) => (
                  <li key={`${item.publishedAt}-${item.headline}`} className="py-3">
                    <p className="nums text-xs text-fg-3">{dateTime.format(new Date(item.publishedAt))}</p>
                    <p className="mt-0.5 font-medium text-fg-1">{item.headline}</p>
                    {item.body && <p className="mt-1 text-sm text-pretty text-fg-2">{item.body}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-3">{t("newsEmpty")}</p>
            )}
          </Card>
        </div>

        <div className="space-y-5 lg:space-y-6">
          {position && (
            <Card padding="lg">
              <CardHeader>
                <CardTitle>{t("yourPosition")}</CardTitle>
                <Delta
                  bps={
                    position.costBasisCents
                      ? Math.round((position.unrealizedPnlCents / position.costBasisCents) * 10_000)
                      : 0
                  }
                  pill
                />
              </CardHeader>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <dt className="text-sm text-fg-3">{t("positionQuantity")}</dt>
                  <dd className="nums font-medium text-fg-1">{formatShares(position.quantityE6)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-fg-3">{t("positionValue")}</dt>
                  <dd className="nums font-medium text-fg-1">{formatMoney(position.marketValueCents)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-fg-3">{t("positionAvg")}</dt>
                  <dd className="nums font-medium text-fg-1">{formatPrice(position.avgPriceE4)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-fg-3">{t("positionPnl")}</dt>
                  <dd className={cn("nums font-medium", position.unrealizedPnlCents >= 0 ? "text-gain" : "text-loss")}>
                    {formatMoney(position.unrealizedPnlCents, { sign: true })}
                  </dd>
                </div>
              </dl>
            </Card>
          )}

          <Card padding="lg" className="hidden lg:block">
            <div className="grid grid-cols-2 gap-3">
              <Button variant="gain" size="lg" data-tour="buy" onClick={() => setOrder("buy")} disabled={!security}>
                {t("buy")}
              </Button>
              <Button variant="loss" size="lg" onClick={() => setOrder("sell")} disabled={!security || held === 0}>
                {t("sell")}
              </Button>
            </div>
            <p className="mt-3 text-center text-xs text-fg-3">{held === 0 ? t("sellHint") : to("shortcutHint")}</p>
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
                      {stat.value ?? <span className="text-fg-3">–</span>}
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
              <OrderBook ticker={ticker} />
            </Card>
          </Reveal>
        </div>
      </div>

      {/* Phones: thumb-reachable actions above the tab bar. */}
      <div className="fixed inset-x-0 bottom-[calc(var(--tabbar-height)+var(--safe-bottom))] z-sticky grid grid-cols-2 gap-3 border-t border-line-1 bg-bg/92 px-4 py-3 backdrop-blur-lg lg:hidden">
        <Button variant="gain" data-tour="buy" onClick={() => setOrder("buy")} disabled={!security}>
          {t("buy")}
        </Button>
        <Button variant="loss" onClick={() => setOrder("sell")} disabled={!security || held === 0}>
          {t("sell")}
        </Button>
      </div>
      <div aria-hidden className="h-16 lg:hidden" />

      <OrderSheet ticker={ticker} side={order} onClose={() => setOrder(null)} />
    </>
  );
}
