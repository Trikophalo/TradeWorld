"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useStockFigureDetail, useStockFigures } from "@/features/game/hooks";
import type { StockFigures } from "@/features/game/types";
import { useDisclosed } from "@/features/progression/components/reveal";
import { formatBps, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { revenueTrend, type RevenueTrend } from "../stock-figures";

const money = (cents: number) => formatMoney(cents, { compact: true });
const TREND_TONE: Record<RevenueTrend, string> = { up: "text-gain", down: "text-loss", flat: "text-fg-3" };

/** Pixel arrow of the revenue trend with a spoken label (ADR-184). */
function TrendArrow({ trend, className }: { trend: RevenueTrend | null; className?: string }) {
  const t = useTranslations("markets.figures.trend");
  if (!trend) return null;
  return (
    <span className={cn("inline-flex items-center", TREND_TONE[trend], className)} data-trend={trend}>
      <svg viewBox="0 0 5 3" width="10" height="6" shapeRendering="crispEdges" aria-hidden>
        <path
          fill="currentColor"
          d={
            trend === "up"
              ? "M2 0h1v1H2zM1 1h3v1H1zM0 2h5v1H0z"
              : trend === "down"
                ? "M0 0h5v1H0zM1 1h3v1H1zM2 2h1v1H2z"
                : "M0 1h5v1H0z"
          }
        />
      </svg>
      <span className="sr-only">{t(trend)}</span>
    </span>
  );
}

/**
 * One compact line under a stock in the market list: "Umsatz 24 h 12.345 € ↑" for player companies, the latest
 * quarter for AI companies (ADR-184). Shown after the tutorial, like the key figures.
 */
export function StockFiguresLine({ ticker }: { ticker: string }) {
  const t = useTranslations("markets.figures");
  const enabled = useDisclosed("stockFigures");
  const { data } = useStockFigures(ticker, enabled);
  if (!enabled || !data) return null;
  const amount = money(data.revenueCents);
  return (
    <span className="flex min-w-0 items-center gap-1 nums text-xs text-fg-2" data-testid="stock-figures-line">
      <span className="truncate">{data.period === "day" ? t("rowDay", { amount }) : t("rowQuarter", { amount })}</span>
      <TrendArrow trend={revenueTrend(data)} className="shrink-0" />
    </span>
  );
}

/** Bars of the revenue per hour (or per quarter), oldest first. */
function RevenueBars({ figures }: { figures: StockFigures }) {
  const t = useTranslations("markets.figures");
  const values = figures.history;
  if (values.length < 2) return null;
  const W = 240;
  const H = 48;
  const max = Math.max(1, ...values);
  const gap = 2;
  const width = (W - gap * (values.length - 1)) / values.length;
  return (
    <figure className="space-y-1">
      <figcaption className="text-xs text-fg-3">
        {figures.period === "day" ? t("historyDay") : t("historyQuarter")}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t("historyLabel", {
          count: values.length,
          from: money(values[0]!),
          to: money(values.at(-1)!),
        })}
        className="block h-12 w-full"
        data-testid="stock-figures-history"
      >
        {values.map((v, i) => {
          const h = Math.max(1, (Math.max(0, v) / max) * H);
          return (
            <rect
              key={i}
              x={i * (width + gap)}
              y={H - h}
              width={width}
              height={h}
              rx={1}
              className={i === values.length - 1 ? "fill-accent" : "fill-fg-3"}
            />
          );
        })}
      </svg>
    </figure>
  );
}

function Figure({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId}>
      <dt className="text-sm text-fg-3">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1.5 nums font-medium text-fg-1">{children}</dd>
    </div>
  );
}

/**
 * "Geschäftszahlen" on the stock detail page (ADR-184): what the company earns right now. Player companies from
 * their closed hours (with reputation and awareness), AI companies from their latest quarterly report.
 */
export function StockFiguresCard({ ticker }: { ticker: string }) {
  const t = useTranslations("markets.figures");
  const { data, isPending } = useStockFigureDetail(ticker);
  if (!isPending && !data) return null;
  const day = data?.period === "day";
  const trend = data ? revenueTrend(data) : null;
  const source = !data
    ? null
    : day
      ? t("sourceDay")
      : data.gameYear != null && data.quarter != null
        ? t("sourceQuarterOf", { quarter: data.quarter, year: data.gameYear })
        : t("sourceQuarter");

  return (
    <Card padding="lg" data-testid="stock-figures">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{t("title")}</CardTitle>
          {source ? <p className="mt-0.5 text-xs text-fg-3">{source}</p> : <Skeleton className="mt-1 h-3 w-40" />}
        </div>
      </CardHeader>
      {!data ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Figure label={day ? t("revenueDay") : t("revenueQuarter")} testId="stock-figures-revenue">
              {money(data.revenueCents)}
              <TrendArrow trend={trend} />
            </Figure>
            <Figure label={day ? t("profitDay") : t("profitQuarter")}>
              <span className={cn(data.profitCents > 0 ? "text-gain" : data.profitCents < 0 ? "text-loss" : "")}>
                {formatMoney(data.profitCents, { compact: true, sign: true })}
              </span>
            </Figure>
            {day && (
              <Figure label={t("lastHour")}>
                {data.lastHourRevenueCents != null ? (
                  money(data.lastHourRevenueCents)
                ) : (
                  <span className="text-fg-3">–</span>
                )}
              </Figure>
            )}
            {data.reputation != null && (
              <Figure label={t("reputation")}>{t("reputationValue", { value: data.reputation })}</Figure>
            )}
            {data.awarenessBps != null && (
              <Figure label={t("awareness")}>{formatBps(data.awarenessBps).replace(/^\+/, "")}</Figure>
            )}
          </dl>
          {trend && (
            <p className="text-xs text-fg-3">
              <span aria-hidden>
                <TrendArrow trend={trend} className="mr-1" />
              </span>
              {t(`trend.${trend}`)} {day ? t("versusDay") : t("versusQuarter")}
            </p>
          )}
          {day && data.hours === 0 ? (
            <p className="text-xs text-pretty text-fg-3">{t("noHours")}</p>
          ) : (
            <RevenueBars figures={data} />
          )}
        </div>
      )}
    </Card>
  );
}
