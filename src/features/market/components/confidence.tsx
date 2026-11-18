"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BEAR, BULL, SECTOR_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMarketMood, useStockConfidence } from "@/features/game/hooks";
import type { ConfidenceReason, MarketMoodBase } from "@/features/game/types";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

/*
 * Investor confidence and market mood (ADR-216): a gauge 0..100 with its level, the 24-hour trend, a sparkline of
 * the history and the strongest reasons; the market mood card for the overview.
 */
export type ConfidenceLevel = "panic" | "low" | "neutral" | "high" | "euphoria";

export function confidenceLevel(value: number): ConfidenceLevel {
  if (value < 15) return "panic";
  if (value < 40) return "low";
  if (value <= 60) return "neutral";
  if (value <= 85) return "high";
  return "euphoria";
}

const LEVEL_TONE = {
  panic: "loss",
  low: "warn",
  neutral: "neutral",
  high: "gain",
  euphoria: "gain",
} as const satisfies Record<ConfidenceLevel, "loss" | "warn" | "neutral" | "gain">;

const LEVEL_TEXT: Record<ConfidenceLevel, string> = {
  panic: "text-loss",
  low: "text-warn",
  neutral: "text-fg-1",
  high: "text-gain",
  euphoria: "text-gain",
};

/** A horizontal gauge: four zones and a marker that moves with transform only. */
export function ConfidenceGauge({ value, label, className }: { value: number; label: string; className?: string }) {
  const ratio = Math.min(100, Math.max(0, value)) / 100;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className={cn("relative h-4 overflow-hidden px-1", className)}
    >
      <div className="relative h-full">
        <div className="absolute inset-x-0 top-1 flex h-2 gap-0.5 overflow-hidden rounded-xs" aria-hidden>
          <span className="h-full w-[15%] bg-loss" />
          <span className="h-full w-[25%] bg-warn opacity-80" />
          <span className="h-full w-[20%] bg-surface-3" />
          <span className="h-full w-[25%] bg-gain opacity-80" />
          <span className="h-full flex-1 bg-gain" />
        </div>
        {/* the wrapper is as wide as the track, so translateX(x %) puts its left edge at x %; the root clips it */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          initial={false}
          animate={{ x: `${ratio * 100}%` }}
          transition={SPRING.smooth}
        >
          <span className="absolute top-0 -left-1 h-4 w-2 rounded-xs border-2 border-surface-1 bg-fg-1" />
        </motion.div>
      </div>
    </div>
  );
}

/** Sparkline of hourly values (0..100), oldest first. */
export function ConfidenceSparkline({
  values,
  label,
  className,
}: {
  values: readonly number[];
  label: string;
  className?: string;
}) {
  if (values.length < 2) return null;
  const W = 120;
  const H = 28;
  const points = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * W).toFixed(1)},${(H - (Math.min(100, Math.max(0, v)) / 100) * H).toFixed(1)}`,
    )
    .join(" ");
  const up = values.at(-1)! >= values[0]!;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={cn("h-7 w-full", className)}
    >
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="stroke-line-1" strokeDasharray="2 3" strokeWidth="1" />
      <polyline
        points={points}
        fill="none"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        className={up ? "stroke-gain" : "stroke-loss"}
      />
    </svg>
  );
}

/** Factor keys with a label in messages (confidence.reasons); unknown ones show as "other". */
export const REASON_KEYS = [
  "earnings",
  "news",
  "market",
  "event",
  "scandal",
  "incident",
  "incident_open",
  "payout",
  "withdraw",
  "insider",
  "dilution",
  "profit",
  "reputation",
  "crisis",
  "country",
  "management",
  "volatility",
  "macro",
  "sector",
  "momentum",
  "valuation",
  "chatter",
] as const;
type ReasonKey = (typeof REASON_KEYS)[number];
const isReasonKey = (key: string): key is ReasonKey => (REASON_KEYS as readonly string[]).includes(key);
const isSector = (key: string): key is keyof typeof SECTOR_ICONS => Object.hasOwn(SECTOR_ICONS, key);

/** One reason with its label (up or down) and its points. */
export function ConfidenceReasons({ reasons }: { reasons: readonly ConfidenceReason[] }) {
  const t = useTranslations("confidence");
  if (reasons.length === 0) return <p className="text-sm text-fg-3">{t("noReasons")}</p>;
  return (
    <ul className="space-y-1.5" data-testid="confidence-reasons">
      {reasons.map((r) => {
        const key = isReasonKey(r.key) ? r.key : "other";
        return (
          <li key={r.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-xs", r.points >= 0 ? "bg-gain" : "bg-loss")} />
              <span className="truncate text-fg-1">{t(`reasons.${key}.${r.points >= 0 ? "up" : "down"}`)}</span>
            </span>
            <span className={cn("shrink-0 nums", r.points >= 0 ? "text-gain" : "text-loss")}>
              {r.points > 0 ? "+" : r.points < 0 ? "−" : ""}
              {Math.abs(r.points).toLocaleString("de-DE", { maximumFractionDigits: 1 })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Value, level badge and 24-hour trend in one row. */
function ValueRow({ value, trend }: { value: number; trend: number }) {
  const t = useTranslations("confidence");
  const level = confidenceLevel(value);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div className="flex items-baseline gap-2">
        <span className={cn("nums text-3xl font-semibold", LEVEL_TEXT[level])} data-testid="confidence-value">
          {Math.round(value)}
        </span>
        <span className="nums text-sm text-fg-3">/ 100</span>
        <Badge tone={LEVEL_TONE[level]}>{t(`levels.${level}`)}</Badge>
      </div>
      <span
        className={cn("nums text-sm font-medium", trend > 0 ? "text-gain" : trend < 0 ? "text-loss" : "text-fg-3")}
        aria-label={t("trendLabel")}
      >
        {trend > 0 ? "+" : trend < 0 ? "−" : "±"}
        {Math.abs(Math.round(trend))} · {t("trend")}
      </span>
    </div>
  );
}

function ConfidenceSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

/**
 * Investor confidence of a stock: on the stock page ("stock") and on the dashboard of the own listed company
 * ("company", with a hint and Mira when it is low).
 */
export function StockConfidenceCard({ ticker, variant = "stock" }: { ticker: string; variant?: "stock" | "company" }) {
  const t = useTranslations("confidence");
  const { data, isPending, isError } = useStockConfidence(ticker);
  return (
    <Card padding="lg" data-testid="stock-confidence">
      <CardHeader>
        <CardTitle>{variant === "company" ? t("companyTitle") : t("title")}</CardTitle>
        {data && <MoodBadge market={data.market} />}
      </CardHeader>
      {isPending ? (
        <ConfidenceSkeleton />
      ) : isError || !data ? (
        <p className="text-sm text-fg-3">{t("loadError")}</p>
      ) : (
        <div className="space-y-4">
          <ValueRow value={data.confidence} trend={data.trend} />
          <ConfidenceGauge value={data.confidence} label={t("gaugeLabel", { value: Math.round(data.confidence) })} />
          <ConfidenceSparkline
            values={data.history}
            label={t("historyLabel", {
              from: Math.round(data.history[0] ?? data.confidence),
              to: Math.round(data.confidence),
            })}
          />
          <div>
            <p className="mb-2 label-pixel text-fg-3">{t("reasonsTitle")}</p>
            <ConfidenceReasons reasons={data.reasons} />
          </div>
          <p className="text-xs text-pretty text-fg-3">{variant === "company" ? t("companyHint") : t("intro")}</p>
          {variant === "company" && data.confidence < 40 && (
            <p className="rounded-sm bg-warn-soft px-3 py-2 text-sm text-pretty text-warn" data-testid="confidence-low">
              {t("companyLow")}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function MoodBadge({ market }: { market: MarketMoodBase }) {
  const t = useTranslations("confidence.mood");
  return (
    <Badge
      tone={market.phase === "bull" ? "gain" : market.phase === "bear" ? "loss" : "neutral"}
      data-phase={market.phase}
    >
      {t(`phases.${market.phase}`)}
    </Badge>
  );
}

const time = new Intl.DateTimeFormat("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit" });

/** Market mood on the market overview: gauge, phase, trend, sector rotation, most and least trusted stocks. */
export function MarketMoodCard() {
  const t = useTranslations("confidence.mood");
  const ts = useTranslations("sectors");
  const { data, isPending, isError } = useMarketMood();
  return (
    <Card padding="lg" data-testid="market-mood">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PixelIcon {...(data?.phase === "bear" ? BEAR : BULL)} scale={1} />
          {t("title")}
        </CardTitle>
        {data && (
          <span className="flex items-center gap-2">
            <MoodBadge market={data} />
            {data.phaseStartedAt && (
              <span className="hidden text-xs text-fg-3 sm:inline">
                {t("since", { time: time.format(new Date(data.phaseStartedAt)) })}
              </span>
            )}
          </span>
        )}
      </CardHeader>
      {isPending ? (
        <ConfidenceSkeleton />
      ) : isError || !data ? (
        <p className="text-sm text-fg-3">{t("loadError")}</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-3">
            <ValueRow value={data.mood} trend={data.trend} />
            <ConfidenceGauge value={data.mood} label={t("gaugeLabel", { value: Math.round(data.mood) })} />
            <ConfidenceSparkline values={data.history} label={t("gaugeLabel", { value: Math.round(data.mood) })} />
            <p className="flex flex-wrap justify-between gap-2 nums text-xs text-fg-3">
              <span>{t("average", { value: Math.round(data.avgConfidence) })}</span>
              <span>{t("confident", { count: data.confident, total: data.stocks })}</span>
            </p>
            {data.sectors.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="label-pixel text-fg-3">{t("rotation")}</span>
                {data.sectors.map((s) => (
                  <Badge key={s.sector} tone={s.points >= 0 ? "gain" : "loss"}>
                    {isSector(s.sector) && <PixelIcon {...SECTOR_ICONS[s.sector]} scale={1} />}
                    {isSector(s.sector) ? ts(s.sector) : s.sector} · {s.points >= 0 ? t("sectorUp") : t("sectorDown")}
                  </Badge>
                ))}
              </div>
            )}
            <p className="text-xs text-pretty text-fg-3">{t("intro")}</p>
          </div>
          <div className="grid grid-cols-2 gap-4 self-start">
            <PickList title={t("leaders")} items={data.leaders} />
            <PickList title={t("laggards")} items={data.laggards} />
          </div>
        </div>
      )}
    </Card>
  );
}

function PickList({ title, items }: { title: string; items: readonly { ticker: string; confidence: number }[] }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 label-pixel text-fg-3">{title}</p>
      <ul className="space-y-1.5">
        {items.map((s) => (
          <li key={s.ticker}>
            <Link
              href={`/markets/${encodeURIComponent(s.ticker)}`}
              className="flex items-center justify-between gap-2 rounded-xs text-sm focus-ring transition-colors duration-fast hover:text-accent"
            >
              <span className="truncate font-medium text-fg-1">{s.ticker}</span>
              <span className={cn("nums", LEVEL_TEXT[confidenceLevel(s.confidence)])}>{Math.round(s.confidence)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
