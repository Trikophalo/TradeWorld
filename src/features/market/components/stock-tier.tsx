"use client";

import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { BALANCE } from "@/config/balance";
import { useSecurity } from "@/features/game/store";
import type { SizeClass } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { stockTierProgress } from "@/lib/sim/stock-tier";
import { cn } from "@/lib/utils";

/*
 * Stock tiers (ADR-218): the badge of a stock's size class and, for listed player companies, the way up the ladder
 * penny → small cap → mid cap → large cap → blue chip by market cap. The server decides (player_stock_tiers_run);
 * this only shows where the stock stands against the thresholds in BALANCE.trading.playerStockTiers.
 */
const cfg = BALANCE.trading.playerStockTiers;

const TONE: Record<SizeClass, "neutral" | "info" | "accent" | "gain"> = {
  penny: "neutral",
  smallcap: "info",
  midcap: "accent",
  largecap: "gain",
  bluechip: "gain",
};

/** The size class of a stock as a small badge. */
export function StockTierBadge({ tier, className }: { tier: SizeClass; className?: string }) {
  const tt = useTranslations("tiers");
  const t = useTranslations("stockTier");
  return (
    <Badge
      tone={TONE[tier]}
      className={cn("shrink-0", className)}
      title={t("badgeLabel", { tier: tt(tier) })}
      data-testid="stock-tier-badge"
      data-tier={tier}
    >
      {tt(tier)}
    </Badge>
  );
}

/**
 * The way up for a listed player stock: current class, market cap, progress to the next class, the line below which
 * it falls back, and how deep the book is now. Shown on the stock page and on the company dashboard.
 */
export function StockTierCard({ ticker, className }: { ticker: string; className?: string }) {
  const security = useSecurity(ticker);
  if (!security) return <Skeleton className={cn("h-48 w-full rounded-lg", className)} />;
  if (security.kind !== "stock" || security.companyKind !== "player" || !security.sizeClass) return null;
  return (
    <StockTierView tier={security.sizeClass} marketCapCents={security.marketCapCents ?? 0} className={className} />
  );
}

export function StockTierView({
  tier,
  marketCapCents,
  className,
}: {
  tier: SizeClass;
  marketCapCents: number;
  className?: string;
}) {
  const t = useTranslations("stockTier");
  const tt = useTranslations("tiers");
  const p = stockTierProgress(tier, marketCapCents);
  const depth = BALANCE.trading.playerImpact.depthCentsPer100Bps[p.tier];
  return (
    <Card padding="lg" className={cn("space-y-4", className)} data-testid="stock-tier">
      <div className="flex items-start gap-3">
        <PixelIcon {...UI_ICONS.star} scale={2} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-fg-1">{t("title")}</p>
          <p className="text-xs text-pretty text-fg-3">{t("intro")}</p>
        </div>
        <StockTierBadge tier={p.tier} />
      </div>
      <ol className="flex flex-wrap items-center gap-1.5" aria-label={t("ladderLabel")}>
        {cfg.ladder.map((r, i) => {
          const done = i < p.rung;
          const current = i === p.rung;
          return (
            <li key={r.tier} className="flex items-center gap-1.5" data-rung={r.tier} data-done={done}>
              {i > 0 && <span aria-hidden className={cn("h-0.5 w-3", done || current ? "bg-gain" : "bg-line-2")} />}
              <span
                aria-current={current ? "step" : undefined}
                className={cn(
                  "rounded-pill border px-2 py-0.5 text-2xs",
                  done
                    ? "border-gain/50 bg-gain-soft text-gain"
                    : current
                      ? "border-accent bg-accent-soft text-fg-1"
                      : "border-line-1 text-fg-3",
                )}
              >
                {tt(r.tier)}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
          <span className="nums font-semibold text-fg-1">
            {t("cap", { amount: formatMoney(marketCapCents, { whole: true }) })}
          </span>
          <span className="nums text-xs text-fg-3">
            {p.next && p.nextAtCents !== null
              ? t("next", { tier: tt(p.next), amount: formatMoney(p.nextAtCents, { whole: true }) })
              : t("top")}
          </span>
        </div>
        <Progress value={p.share} label={t("progressLabel")} tone={p.next ? "accent" : "gold"} size="sm" />
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-fg-3">
          <span className="nums">{t("depth", { amount: formatMoney(depth, { whole: true }) })}</span>
          {p.downAtCents !== null && (
            <span className="nums">{t("down", { amount: formatMoney(p.downAtCents, { whole: true }) })}</span>
          )}
        </div>
      </div>
      <p className="text-2xs text-pretty text-fg-3">
        {t("checked", { minutes: cfg.checkEveryMinutes, hours: cfg.minHoursBetweenChanges })}
      </p>
    </Card>
  );
}
