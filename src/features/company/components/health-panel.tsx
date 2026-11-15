"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { MIRA, UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { DURATION, EASE, SPRING, STAGGER } from "@/lib/motion";
import type { CompanyHealth, HealthFactor, HealthFactorKey, HealthStatus } from "@/lib/sim/company-health";
import { cn } from "@/lib/utils";
import { useHealthText } from "../health";

/*
 * Company health (ADR-162): eight factors as a spider chart and as bars, the weakest one on top with what it costs.
 * Every factor has a button that hands the question to Mira.
 */

const money = (cents: number) => formatMoney(cents, { whole: true });
const signed = (cents: number) => `${cents > 0 ? "+" : cents < 0 ? "−" : ""}${money(Math.abs(cents))}`;

const TONE: Record<HealthStatus, { text: string; fill: string; bg: string; soft: string }> = {
  good: { text: "text-gain", fill: "fill-gain", bg: "bg-gain", soft: "bg-gain-soft" },
  ok: { text: "text-info", fill: "fill-info", bg: "bg-info", soft: "bg-info-soft" },
  weak: { text: "text-warn", fill: "fill-warn", bg: "bg-warn", soft: "bg-warn-soft" },
  critical: { text: "text-loss", fill: "fill-loss", bg: "bg-loss", soft: "bg-loss-soft" },
};

export type AskMira = (factor: HealthFactorKey) => void;

/** The full panel at the top of the company overview. */
export function HealthPanel({ health, onAsk }: { health: CompanyHealth; onAsk: AskMira }) {
  const t = useTranslations("companyHealth");
  const weakest = health.factors.find((f) => f.key === health.weakest)!;
  return (
    <Card padding="lg" className="space-y-5" data-testid="company-health">
      <Header health={health} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-6">
        <div className="space-y-4">
          <HealthRadar health={health} />
          <Weakest factor={weakest} onAsk={onAsk} />
        </div>
        <ol className="grid gap-2 sm:grid-cols-2" aria-label={t("listLabel")}>
          {health.factors.map((f, i) => (
            <FactorRow key={f.key} factor={f} weakest={f.key === health.weakest} index={i} onAsk={onAsk} />
          ))}
        </ol>
      </div>
      {health.estimated && <p className="text-xs text-pretty text-fg-3">{t("estimated")}</p>}
    </Card>
  );
}

/** A small version for the Mira tab: chart, weakest point, one button. */
export function HealthCompact({
  health,
  onAsk,
  onShowAll,
}: {
  health: CompanyHealth;
  onAsk: AskMira;
  onShowAll: () => void;
}) {
  const t = useTranslations("companyHealth");
  const text = useHealthText();
  const weakest = health.factors.find((f) => f.key === health.weakest)!;
  const allGood = weakest.status === "good" && weakest.impactCents === 0;
  return (
    <Card padding="md" className="flex items-center gap-3 sm:gap-4" data-testid="company-health-compact">
      <HealthRadar health={health} compact className="w-24 shrink-0 sm:w-28" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="label-pixel text-fg-2">{t("title")}</span>
          <ProfitNow cents={health.profitPerHourCents} small />
        </p>
        <p className="text-sm text-pretty text-fg-1">
          {allGood ? (
            t("allGood")
          ) : (
            <>
              {t("weakestShort")}{" "}
              <span className={cn("font-semibold", TONE[weakest.status].text)}>{text.factor(weakest.key)}</span>
              {weakest.impactCents > 0 && (
                <span className="nums text-fg-3"> · {t("impact", { amount: money(weakest.impactCents) })}</span>
              )}
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {!allGood && (
            <Button size="sm" onClick={() => onAsk(weakest.key)} data-testid="health-compact-ask">
              {t("ask")}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onShowAll}>
            {t("showAll")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Header({ health }: { health: CompanyHealth }) {
  const t = useTranslations("companyHealth");
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 label-pixel text-fg-2">
          <PixelIcon {...UI_ICONS.star} scale={1} />
          {t("title")}
        </p>
        <p className="mt-1 text-sm text-pretty text-fg-3">{t("intro")}</p>
      </div>
      <div className="text-right">
        <ProfitNow cents={health.profitPerHourCents} />
        <p className="nums text-xs text-fg-3">{t("score", { score: health.score })}</p>
      </div>
    </div>
  );
}

function ProfitNow({ cents, small }: { cents: number; small?: boolean }) {
  const t = useTranslations("companyHealth");
  return (
    <span className="block" data-testid="health-profit">
      <span className="sr-only">{t(cents >= 0 ? "profitNow" : "lossNow")}: </span>
      <span
        className={cn(
          "nums font-semibold",
          small ? "text-sm" : "text-lg",
          cents > 0 ? "text-gain" : cents < 0 ? "text-loss" : "text-fg-2",
        )}
      >
        {t("perHour", { amount: signed(cents) })}
      </span>
      {!small && (
        <span className="block text-2xs text-fg-3" aria-hidden>
          {t(cents >= 0 ? "profitNow" : "lossNow")}
        </span>
      )}
    </span>
  );
}

function Weakest({ factor, onAsk }: { factor: HealthFactor; onAsk: AskMira }) {
  const t = useTranslations("companyHealth");
  const text = useHealthText();
  const good = factor.status === "good" && factor.impactCents === 0;
  return (
    <div
      className={cn("space-y-2 rounded-md px-4 py-3", good ? "bg-gain-soft" : TONE[factor.status].soft)}
      data-testid="health-weakest"
    >
      {good ? (
        <p className="text-sm font-semibold text-gain">{t("allGood")}</p>
      ) : (
        <>
          <p className="text-sm text-fg-1">
            {t("weakest")}{" "}
            <span className={cn("font-semibold", TONE[factor.status].text)}>{text.factor(factor.key)}</span>
          </p>
          <p className="text-sm text-pretty text-fg-2">{text.reason(factor)}</p>
          <p className="nums text-xs text-fg-3">
            {factor.impactCents > 0 ? t("weakestGain", { amount: money(factor.impactCents) }) : t("weakestNoGain")}
          </p>
          <Button size="sm" onClick={() => onAsk(factor.key)} data-testid="health-weakest-ask">
            <PixelIcon {...MIRA.idle} scale={1} />
            {t("ask")}
          </Button>
        </>
      )}
    </div>
  );
}

function FactorRow({
  factor,
  weakest,
  index,
  onAsk,
}: {
  factor: HealthFactor;
  weakest: boolean;
  index: number;
  onAsk: AskMira;
}) {
  const t = useTranslations("companyHealth");
  const text = useHealthText();
  const tone = TONE[factor.status];
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.slow, ease: EASE.out, delay: index * STAGGER }}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-md border bg-surface-2 px-3 py-2.5",
        weakest ? "border-line-2 ring-1 ring-line-2" : "border-line-1",
      )}
      data-testid="health-factor"
      data-factor={factor.key}
      data-status={factor.status}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold text-fg-1">{text.factor(factor.key)}</span>
        <span className="flex shrink-0 items-baseline gap-1.5">
          <span className={cn("text-2xs font-medium", tone.text)}>{t(`status.${factor.status}`)}</span>
          <span className="nums text-sm font-semibold text-fg-1">{factor.score}</span>
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-pill bg-surface-3"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={factor.score}
        aria-label={text.factor(factor.key)}
      >
        <motion.div
          className={cn("h-full origin-left rounded-pill", tone.bg)}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: factor.score / 100 }}
          transition={SPRING.smooth}
        />
      </div>
      <p className="text-xs text-pretty text-fg-2">{text.reason(factor)}</p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="nums text-2xs text-fg-3">
          {factor.impactCents > 0 ? t("impact", { amount: money(factor.impactCents) }) : ""}
        </span>
        <button
          type="button"
          onClick={() => onAsk(factor.key)}
          className="group inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-xs font-medium text-accent focus-ring transition duration-fast hover:bg-accent-soft active:scale-[0.97]"
          data-testid="health-ask"
        >
          {t("ask")}
          <span aria-hidden className="transition-transform duration-fast group-hover:translate-x-0.5">
            →
          </span>
        </button>
      </div>
    </motion.li>
  );
}

// ---- The spider chart ------------------------------------------------------------------------------------------------

const W = 320;
const H = 236;
const CX = W / 2;
const CY = H / 2;
const R = 82;

const point = (i: number, n: number, share: number, radius = R) => {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return [CX + Math.cos(angle) * radius * share, CY + Math.sin(angle) * radius * share] as const;
};
const polygon = (shares: number[]) =>
  shares
    .map((s, i) => point(i, shares.length, s))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

/** Eight axes, rings at 25/50/75/100, the company's shape on top; the weakest axis is marked. */
export function HealthRadar({
  health,
  compact,
  className,
}: {
  health: CompanyHealth;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("companyHealth");
  const text = useHealthText();
  const n = health.factors.length;
  const shares = health.factors.map((f) => Math.max(0.04, f.score / 100));
  const box = compact ? `${CX - R - 6} ${CY - R - 6} ${2 * R + 12} ${2 * R + 12}` : `0 0 ${W} ${H}`;
  const summary = health.factors.map((f) => `${text.factor(f.key)} ${f.score}`).join(", ");
  return (
    <svg
      viewBox={box}
      role="img"
      aria-label={`${t("chartLabel")}: ${summary}`}
      className={cn("mx-auto block h-auto w-full", !compact && "max-w-[340px]", className)}
      data-testid="health-radar"
    >
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon
          key={ring}
          points={polygon(Array.from({ length: n }, () => ring))}
          className={cn("fill-none", ring === 1 ? "stroke-line-2" : "stroke-line-1")}
          strokeWidth={1}
        />
      ))}
      {health.factors.map((f, i) => {
        const [x, y] = point(i, n, 1);
        return <line key={f.key} x1={CX} y1={CY} x2={x} y2={y} className="stroke-line-1" strokeWidth={1} />;
      })}
      {/* The shape grows out of the centre; the transparent square keeps the centre as its origin. */}
      <motion.g
        initial={{ scale: 0.2, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: DURATION.slower, ease: EASE.out }}
      >
        <rect x={CX - R} y={CY - R} width={2 * R} height={2 * R} className="fill-none" stroke="none" />
        <polygon
          points={polygon(shares)}
          className="fill-accent stroke-accent"
          fillOpacity={0.18}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {health.factors.map((f, i) => {
          const [x, y] = point(i, n, shares[i]!);
          const weakest = f.key === health.weakest;
          return (
            <g key={f.key}>
              {weakest && (
                <circle cx={x} cy={y} r={compact ? 9 : 8} className={cn(TONE[f.status].fill)} fillOpacity={0.25} />
              )}
              <circle
                cx={x}
                cy={y}
                r={weakest ? 4.5 : 3.5}
                className={cn(TONE[f.status].fill, "stroke-surface-1")}
                strokeWidth={1.5}
              />
            </g>
          );
        })}
      </motion.g>
      {!compact &&
        health.factors.map((f, i) => {
          const [x, y] = point(i, n, 1, R + 12);
          const dx = x - CX;
          const anchor = Math.abs(dx) < 4 ? "middle" : dx > 0 ? "start" : "end";
          const dy = y < CY - R + 4 ? -4 : y > CY + R - 4 ? 12 : 4;
          const weakest = f.key === health.weakest;
          return (
            <text
              key={f.key}
              x={x}
              y={y + dy}
              textAnchor={anchor}
              className={cn("text-2xs", weakest ? cn("font-semibold", TONE[f.status].fill) : "fill-fg-2")}
            >
              {text.factor(f.key)}
              <tspan className="fill-fg-3 nums" dx={4}>
                {f.score}
              </tspan>
            </text>
          );
        })}
    </svg>
  );
}
