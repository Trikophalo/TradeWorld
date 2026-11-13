"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BEAR } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { Delta } from "@/components/ui/delta";
import { EmptyState } from "@/components/ui/empty-state";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { BALANCE } from "@/config/balance";
import { TrustBadge } from "@/features/deals/components/trust-badge";
import { usePlayerLevel } from "@/features/game/store";
import { GameError, type CoinDetail, type CoinStats } from "@/features/game/types";
import { PriceChart } from "@/features/market/components/price-chart";
import { useAgo } from "@/features/social/components/feed";
import { formatBps, formatMoney, formatPrice, formatShares } from "@/lib/format";
import { useSettings } from "@/stores/settings";
import { cn } from "@/lib/utils";
import { useCryptoEventText } from "../events";
import { COIN_RANGES, useCoin, useCoinCandles, useMyCoin, type CoinRange } from "../hooks";
import { CoinLogo } from "./coin-logo";
import { RISK_TONE } from "./crypto-market";
import { CoinTradeSheet, type TradeSide } from "./trade-sheet";

const cfg = BALANCE.crypto;
const plainPct = (bps: number) => formatBps(bps).replace(/^\+/, "");

/** One coin (ADR-101): price and chart, numbers, own position, the creator of a player coin and its events. */
export function CoinDetailView({ ticker }: { ticker: string }) {
  const t = useTranslations("crypto");
  const level = usePlayerLevel();
  const unlocked = level >= cfg.minLevel;
  const coin = useCoin(ticker, unlocked);
  const mine = useMyCoin(level >= cfg.createMinLevel);
  const [range, setRange] = useState<CoinRange>("1T");
  const [side, setSide] = useState<TradeSide | null>(null);

  if (!unlocked || (coin.error instanceof GameError && coin.error.key !== "coin_not_found")) {
    return (
      <EmptyState
        art={<PixelIcon {...BEAR} scale={4} />}
        title={t("lockedTitle")}
        description={t("lockedText", { level: cfg.minLevel })}
        action={
          <Link href="/crypto" className={buttonVariants({ variant: "secondary" })}>
            {t("back")}
          </Link>
        }
      />
    );
  }
  if (coin.isError) {
    return (
      <EmptyState
        art={<PixelIcon {...BEAR} scale={4} />}
        title={t("notFoundTitle")}
        description={t("notFoundText")}
        action={
          <Link href="/crypto" className={buttonVariants({ variant: "secondary" })}>
            {t("back")}
          </Link>
        }
      />
    );
  }
  const c = coin.data;

  return (
    <>
      <Link
        href="/crypto"
        transitionTypes={["nav-back"]}
        className="-ml-2 inline-flex h-9 items-center gap-2 rounded-sm px-2 label-pixel text-fg-2 focus-ring transition-colors duration-fast hover:text-fg-1"
      >
        <span aria-hidden>‹</span>
        {t("back")}
      </Link>

      {!c ? (
        <DetailSkeleton />
      ) : (
        <div className="space-y-5 lg:space-y-6" data-testid="coin-detail" data-ticker={c.ticker}>
          <header className="flex items-center gap-4">
            <CoinLogo coin={c} scale={4} className={cn(c.status !== "listed" && "opacity-50 grayscale")} />
            <div className="min-w-0">
              <h1 className="truncate font-pixel text-xl text-fg-1 uppercase">{c.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="label-pixel text-fg-3">{c.ticker}</span>
                <Badge tone="neutral">{t(`categories.${c.category}`)}</Badge>
                {c.status === "listed" ? (
                  <Badge tone={RISK_TONE[c.category]}>{t(`risk.${c.category}`)}</Badge>
                ) : (
                  <Badge tone="loss">{t(`status.${c.status}`)}</Badge>
                )}
              </div>
            </div>
          </header>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
            <div className="min-w-0 space-y-5">
              <Card padding="lg" className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <NumberTicker
                      value={c.priceE4}
                      format={(v) => formatPrice(Math.round(v))}
                      flash
                      className="font-pixel text-3xl text-fg-1"
                    />
                    <Delta bps={c.change24hBps} pill className="ml-2 align-middle" />
                  </div>
                  <Segmented
                    value={range}
                    onValueChange={setRange}
                    options={COIN_RANGES.map((value) => ({ value, label: value }))}
                    label={t("chartLabel", { name: c.name, price: formatPrice(c.priceE4) })}
                    size="sm"
                  />
                </div>
                <CoinChart coin={c} range={range} />
                {c.status !== "listed" && (
                  <p className="rounded-md bg-loss-soft px-3 py-2 text-sm text-loss">{t("deadNote")}</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="lg"
                    onClick={() => setSide("buy")}
                    disabled={c.status !== "listed"}
                    data-testid="coin-buy"
                  >
                    {t("buy")}
                  </Button>
                  <Button
                    size="lg"
                    variant="secondary"
                    onClick={() => setSide("sell")}
                    disabled={c.status !== "listed" || !c.myPosition}
                    data-testid="coin-sell"
                  >
                    {t("sell")}
                  </Button>
                </div>
              </Card>
              <Stats coin={c} />
            </div>

            <aside className="space-y-5">
              <PositionCard coin={c} />
              {c.creator && <CreatorCard coin={c} />}
              <EventsCard coin={c} />
            </aside>
          </div>
          <CoinTradeSheet coin={c} side={side} onClose={() => setSide(null)} mine={mine.data ?? null} />
        </div>
      )}
    </>
  );
}

function CoinChart({ coin, range }: { coin: CoinDetail; range: CoinRange }) {
  const t = useTranslations("crypto");
  const candles = useCoinCandles(coin.ticker, range);
  const chartStyle = useSettings((state) => (state.chartStyle === "candles" ? "candles" : "area"));
  return (
    <PriceChart
      candles={candles.data}
      liveE4={coin.priceE4}
      chartStyle={chartStyle}
      positive={coin.change24hBps >= 0}
      label={t("chartLabel", { name: coin.name, price: formatPrice(coin.priceE4) })}
      className="h-64 lg:h-96"
    />
  );
}

function Stats({ coin }: { coin: CoinDetail }) {
  const t = useTranslations("crypto.stats");
  const items = [
    { label: t("marketCap"), value: formatMoney(coin.marketCapCents, { compact: true }) },
    { label: t("pool"), value: formatMoney(coin.poolCents, { compact: true }) },
    { label: t("volume"), value: formatMoney(coin.volume24hCents, { compact: true }) },
    { label: t("fee"), value: plainPct(coin.feeBps) },
    { label: t("holders"), value: coin.holders.toLocaleString("de-DE") },
    { label: t("supply"), value: formatShares(coin.supplyE6) },
    { label: t("range"), value: `${formatPrice(coin.low24hE4)} – ${formatPrice(coin.high24hE4)}` },
  ];
  return (
    <Card padding="lg">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="text-xs text-fg-3">{item.label}</dt>
            <dd className="truncate nums text-sm font-medium text-fg-1">{item.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function PositionCard({ coin }: { coin: CoinDetail }) {
  const t = useTranslations("crypto.position");
  const p = coin.myPosition;
  const cost = p ? Math.round((p.quantityE6 * p.avgPriceE4) / 100_000_000) : 0;
  const pnl = p ? p.valueCents - cost : 0;
  return (
    <Card padding="lg" className="space-y-3" data-testid="coin-position">
      <h2 className="label-pixel text-fg-2">{t("title")}</h2>
      {!p ? (
        <p className="text-sm text-fg-3">{t("none", { ticker: coin.ticker })}</p>
      ) : (
        <>
          <p className="font-pixel nums text-xl text-fg-1">
            {formatShares(p.quantityE6)} <span className="text-sm text-fg-3">{coin.ticker}</span>
          </p>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-fg-3">{t("value")}</dt>
              <dd className="nums text-fg-1">{formatMoney(p.valueCents)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-3">{t("avg")}</dt>
              <dd className="nums text-fg-2">{formatPrice(p.avgPriceE4)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-3">{t("pnl")}</dt>
              <dd className={cn("nums", pnl >= 0 ? "text-gain" : "text-loss")}>{formatMoney(pnl, { sign: true })}</dd>
            </div>
          </dl>
        </>
      )}
    </Card>
  );
}

export function StatBars({ stats }: { stats: CoinStats }) {
  const t = useTranslations("crypto");
  const keys = ["tech", "hype", "utility"] as const;
  const tone = { tech: "accent", hype: "warn", utility: "gain" } as const;
  return (
    <ul className="space-y-3" data-testid="coin-stats">
      {keys.map((k) => (
        <li key={k}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-fg-1">{t(`statsNames.${k}`)}</span>
            <span className="nums text-sm text-fg-2">{stats[k]} / 100</span>
          </div>
          <Progress value={stats[k] / 100} label={t(`statsNames.${k}`)} tone={tone[k]} size="sm" />
          <p className="mt-1 text-xs text-pretty text-fg-3">{t(`statsText.${k}`)}</p>
        </li>
      ))}
    </ul>
  );
}

function CreatorCard({ coin }: { coin: CoinDetail }) {
  const t = useTranslations("crypto.creator");
  const creator = coin.creator!;
  const team = coin.teamTokensE6 ?? 0;
  const share = coin.supplyE6 > 0 ? Math.round((team * 10_000) / coin.supplyE6) : 0;
  return (
    <Card padding="lg" className="space-y-4" data-testid="coin-creator">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="label-pixel text-fg-2">{t("title")}</h2>
          <Link
            href={`/players/${encodeURIComponent(creator.nickname)}`}
            className="truncate font-medium text-fg-1 hover:underline"
          >
            {creator.nickname}
          </Link>
        </div>
        <TrustBadge trust={creator.trust} />
      </div>
      {coin.stats && <StatBars stats={coin.stats} />}
      <p className="text-sm text-fg-2">{team > 0 ? t("teamHolds", { share: plainPct(share) }) : t("teamNone")}</p>
      {team > 0 && <p className="text-xs text-pretty text-warn">{t("warning")}</p>}
    </Card>
  );
}

function EventsCard({ coin }: { coin: CoinDetail }) {
  const t = useTranslations("crypto");
  const text = useCryptoEventText();
  const ago = useAgo();
  return (
    <Card padding="lg" className="space-y-3">
      <h2 className="label-pixel text-fg-2">{t("coinEvents")}</h2>
      {coin.events.length === 0 ? (
        <p className="text-sm text-fg-3">{t("coinEventsEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {coin.events.slice(0, 10).map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0 text-fg-1">
                {text(e)}
                <span className="block text-xs text-fg-3">{ago(e.at)}</span>
              </span>
              {e.shockBps !== 0 && <Delta bps={e.shockBps} className="shrink-0" />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <Skeleton className="size-16 rounded-pill" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-5 w-28" />
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        <Card padding="lg" className="space-y-4">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-64 w-full rounded-md lg:h-96" />
        </Card>
        <Card padding="lg" className="space-y-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-24 w-full" />
        </Card>
      </div>
    </div>
  );
}
