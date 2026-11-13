"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BEAR, BULL, UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { Delta } from "@/components/ui/delta";
import { Skeleton } from "@/components/ui/skeleton";
import { BALANCE } from "@/config/balance";
import { useGame, usePlayerLevel } from "@/features/game/store";
import type { CoinCategory, CoinRow, CryptoEvent, CryptoMarket } from "@/features/game/types";
import { LockedFeature } from "@/features/progression/components/locked-feature";
import { useAgo } from "@/features/social/components/feed";
import { formatMoney, formatPrice, formatShares } from "@/lib/format";
import { SPRING, STAGGER } from "@/lib/motion";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { isMarketEvent, useCryptoEventText } from "../events";
import { useCryptoMarket, useMyCoin } from "../hooks";
import { CoinLogo } from "./coin-logo";

type Filter = "all" | CoinCategory;
const FILTERS: readonly Filter[] = ["all", "stable", "major", "alt", "meme", "player"];
const cfg = BALANCE.crypto;

export const RISK_TONE: Record<CoinCategory, "info" | "neutral" | "warn" | "loss"> = {
  stable: "info",
  major: "neutral",
  alt: "warn",
  meme: "loss",
  player: "loss",
};

/** The crypto market (ADR-101): mood of the market, coins by group, what is happening, the own coin. */
export function CryptoMarketView() {
  const t = useTranslations("crypto");
  const level = usePlayerLevel();
  const unlocked = level >= cfg.minLevel;
  const market = useCryptoMarket(unlocked);
  const holdsAny = useGame((s) => s.portfolio?.positions.some((p) => p.kind === "crypto") ?? false);
  const [filter, setFilter] = useState<Filter>("all");

  if (!unlocked) {
    return (
      <div className="space-y-5">
        <LockedFeature
          level={cfg.minLevel}
          title={t("lockedTitle")}
          description={t("lockedText", { level: cfg.minLevel })}
          art={<PixelIcon {...UI_ICONS.crypto} scale={3} />}
        />
        <Guide />
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
      <div className="min-w-0 space-y-4">
        {market.data ? <RegimeBanner market={market.data} /> : <Skeleton className="h-24 w-full rounded-lg" />}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filterLabel")}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "h-8 rounded-pill border px-3 text-sm focus-ring transition duration-fast active:scale-95",
                filter === f
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line-1 bg-surface-1 text-fg-2 hover:bg-surface-2",
              )}
              data-filter={f}
            >
              {t(`categories.${f}`)}
            </button>
          ))}
        </div>
        {filter !== "all" && <p className="text-sm text-fg-3">{t(`categoryText.${filter}`)}</p>}
        {market.data ? (
          <CoinList
            coins={market.data.coins.filter((c) => filter === "all" || c.category === filter)}
            filter={filter}
          />
        ) : (
          <Card padding="none" className="divide-y divide-line-1">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-8 rounded-pill" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </Card>
        )}
      </div>
      <aside className="space-y-4">
        <MyCoinCard level={level} />
        <EventFeed events={market.data?.events} />
        {!holdsAny && <Guide />}
      </aside>
    </div>
  );
}

function RegimeBanner({ market }: { market: CryptoMarket }) {
  const t = useTranslations("crypto");
  const now = useClock();
  const kind = market.regime.kind;
  const hours = now === null ? null : Math.max(1, Math.round((Date.parse(market.regime.until) - now) / 3_600_000));
  return (
    <Card
      padding="lg"
      className={cn(
        "relative flex items-center gap-4 overflow-hidden",
        kind === "bull" && "border-gain/40 bg-gain-soft/40",
        kind === "bear" && "border-loss/40 bg-loss-soft/40",
      )}
      data-testid="crypto-regime"
      data-regime={kind}
    >
      <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-surface-2">
        {kind === "flat" ? (
          <PixelIcon {...UI_ICONS.markets} scale={3} />
        ) : (
          <PixelIcon {...(kind === "bull" ? BULL : BEAR)} scale={3} />
        )}
      </span>
      <div className="min-w-0">
        <p className="font-pixel text-base text-fg-1 uppercase">{t(`regime.${kind}`)}</p>
        <p className="text-sm text-pretty text-fg-2">{t(`regimeText.${kind}`)}</p>
        {hours !== null && <p className="mt-1 nums text-xs text-fg-3">{t("regimeUntil", { hours })}</p>}
      </div>
    </Card>
  );
}

function CoinList({ coins, filter }: { coins: CoinRow[]; filter: Filter }) {
  const t = useTranslations("crypto");
  const reduced = useReducedMotion();
  if (coins.length === 0) {
    return (
      <Card padding="lg" className="text-sm text-fg-3">
        {filter === "player" ? t("emptyPlayer", { level: cfg.createMinLevel }) : t("empty")}
      </Card>
    );
  }
  return (
    <Card padding="none" className="overflow-hidden">
      <ul className="divide-y divide-line-1" data-testid="coin-list">
        <AnimatePresence initial={false}>
          {coins.map((coin, i) => (
            <motion.li
              key={coin.ticker}
              layout={!reduced}
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ ...SPRING.smooth, delay: reduced ? 0 : Math.min(i, 10) * STAGGER }}
            >
              <CoinRowLink coin={coin} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </Card>
  );
}

function CoinRowLink({ coin }: { coin: CoinRow }) {
  const t = useTranslations("crypto");
  const dead = coin.status !== "listed";
  return (
    <Link
      href={`/crypto/${coin.ticker}`}
      className="flex items-center gap-3 px-4 py-3 focus-ring transition-colors duration-fast hover:bg-surface-2"
      data-testid="coin-row"
      data-ticker={coin.ticker}
    >
      <CoinLogo coin={coin} className={cn("shrink-0", dead && "opacity-40 grayscale")} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium text-fg-1">{coin.name}</span>
          <span className="label-pixel text-fg-3">{coin.ticker}</span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {dead ? (
            <Badge tone="loss">{t(`status.${coin.status}`)}</Badge>
          ) : (
            <Badge tone={RISK_TONE[coin.category]}>{t(`riskShort.${coin.category}`)}</Badge>
          )}
          {coin.myQuantityE6 > 0 && (
            <span className="nums text-xs text-accent">{t("held", { amount: formatShares(coin.myQuantityE6) })}</span>
          )}
        </span>
      </span>
      <span className="text-right">
        <span className="block nums font-medium text-fg-1">{formatPrice(coin.priceE4)}</span>
        <Delta bps={coin.change24hBps} className="text-xs" />
      </span>
    </Link>
  );
}

function EventFeed({ events }: { events: CryptoEvent[] | undefined }) {
  const t = useTranslations("crypto");
  const text = useCryptoEventText();
  const ago = useAgo();
  return (
    <Card padding="lg" className="space-y-3" data-testid="crypto-events">
      <h2 className="label-pixel text-fg-2">{t("eventsTitle")}</h2>
      {!events ? (
        <Skeleton className="h-24 w-full" />
      ) : events.length === 0 ? (
        <p className="text-sm text-fg-3">{t("eventsEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {events.slice(0, 8).map((e, i) => (
            <li key={`${e.at}-${e.key}-${i}`} className="flex items-start gap-2.5 text-sm">
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-pill",
                  e.shockBps > 0 ? "bg-gain" : e.shockBps < 0 ? "bg-loss" : "bg-fg-3",
                )}
              />
              <span className="min-w-0 flex-1">
                {isMarketEvent(e) ? (
                  <span className="text-fg-1">{text(e)}</span>
                ) : (
                  <Link href={`/crypto/${e.ticker}`} className="text-fg-1 hover:underline">
                    {text(e)}
                  </Link>
                )}
                <span className="block nums text-xs text-fg-3">
                  {e.shockBps !== 0 && <Delta bps={e.shockBps} className="mr-1.5" />}
                  {ago(e.at)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function MyCoinCard({ level }: { level: number }) {
  const t = useTranslations("crypto.myCoinCard");
  const ts = useTranslations("crypto.status");
  const canCreate = level >= cfg.createMinLevel;
  const mine = useMyCoin(canCreate);
  const coin = mine.data ?? null;
  return (
    <Card padding="lg" className="space-y-3" data-testid="my-coin-card">
      <h2 className="label-pixel text-fg-2">{t("title")}</h2>
      {!canCreate ? (
        <p className="text-sm text-fg-3">{t("locked", { level: cfg.createMinLevel })}</p>
      ) : coin ? (
        <div className="flex items-center gap-3">
          <CoinLogo coin={coin} scale={3} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-fg-1">{coin.name}</p>
            <p className="text-xs text-fg-3">
              {coin.ticker} · {ts(coin.status)}
            </p>
          </div>
          {coin.status === "listed" && (
            <span className="text-right">
              <span className="block nums text-sm text-fg-1">{formatPrice(coin.priceE4)}</span>
              <Delta bps={coin.change24hBps} className="text-xs" />
            </span>
          )}
        </div>
      ) : (
        <p className="text-sm text-pretty text-fg-2">{t("none")}</p>
      )}
      {canCreate && (
        <Link href="/crypto/studio" className={buttonVariants({ variant: "secondary", block: true })}>
          {t("open")}
        </Link>
      )}
    </Card>
  );
}

/** The four things to know before the first trade. */
export function Guide() {
  const t = useTranslations("crypto");
  const reduced = useReducedMotion();
  const items = ["clock", "pool", "fees", "events"] as const;
  return (
    <Card padding="lg" className="space-y-3" data-testid="crypto-guide">
      <h2 className="label-pixel text-fg-2">{t("guideTitle")}</h2>
      <ol className="space-y-3">
        {items.map((key, i) => (
          <motion.li
            key={key}
            initial={reduced ? false : { opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...SPRING.smooth, delay: reduced ? 0 : i * STAGGER * 2 }}
            className="flex gap-3"
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-xs bg-accent-soft font-pixel text-xs text-accent">
              {i + 1}
            </span>
            <span>
              <span className="block text-sm font-medium text-fg-1">{t(`guide.${key}.title`)}</span>
              <span className="block text-sm text-pretty text-fg-3">{t(`guide.${key}.text`)}</span>
            </span>
          </motion.li>
        ))}
      </ol>
    </Card>
  );
}

export const formatPool = (cents: number) => formatMoney(cents, { compact: true });
