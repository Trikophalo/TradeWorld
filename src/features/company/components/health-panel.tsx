"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { MIRA, UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BALANCE } from "@/config/balance";
import { formatMoney } from "@/lib/format";
import { DURATION, EASE, SPRING, STAGGER } from "@/lib/motion";
import type { CompanyHealth, HealthFactor, HealthFactorKey, HealthStatus } from "@/lib/sim/company-health";
import { cn } from "@/lib/utils";
import { useHealthText } from "../health";
import { InfoTip } from "./firm-layout";

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

/** Which of the six strengths (ADR-176) a factor feeds; image and momentum have their own place. */
const STRENGTH_OF = {
  awareness: "awareness",
  capacity: "delivery",
  quality: "quality",
  image: "reputation",
  price: "margin",
  team: "team",
  cash: "finance",
  momentum: "tasks",
} as const satisfies Record<HealthFactorKey, string>;

/**
 * "Wo es fehlt" (ADR-162, reworked in ADR-183): the eight factors of the last hour, their logic unchanged. A clear
 * chart with values on every axis, the biggest lever with what it is worth, then one row per factor, the costliest
 * first: what it measures, the reason in numbers, what to do, what it would bring, and Mira.
 */
export function HealthPanel({
  health,
  onAsk,
  late,
}: {
  health: CompanyHealth;
  onAsk: AskMira;
  /** No closed hour although the company is hours old: the numbers are estimates and the close is overdue. */
  late?: boolean;
}) {
  const t = useTranslations("companyHealth");
  const weakest = health.factors.find((f) => f.key === health.weakest)!;
  // What costs most first, then the weakest score; the chart keeps the fixed order.
  const rows = [...health.factors].sort((a, b) => b.impactCents - a.impactCents || a.score - b.score);
  const counts = (["critical", "weak", "ok", "good"] as const).map((st) => ({
    status: st,
    count: health.factors.filter((f) => f.status === st).length,
  }));
  return (
    <Card padding="lg" className="space-y-5" data-testid="company-health" data-estimated={health.estimated}>
      <Header health={health} />
      {/* Estimates must not pass for the real hourly numbers: said first, not in a footnote. */}
      {health.estimated && (
        <p
          className={cn(
            "rounded-md px-3 py-2 text-sm text-pretty",
            late ? "bg-warn-soft text-warn" : "bg-info-soft text-info",
          )}
          data-testid="health-estimated"
        >
          {t(late ? "estimatedLate" : "estimated")}
        </p>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-6">
        <div className="space-y-4 lg:sticky lg:top-32">
          <HealthRadar health={health} />
          <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs" aria-label={t("legend")}>
            {counts.map((c) => (
              <li key={c.status} className="inline-flex items-center gap-1.5 text-fg-2">
                <span aria-hidden className={cn("size-2.5 rounded-pill", TONE[c.status].bg)} />
                {t(`status.${c.status}`)} <span className="nums text-fg-3">{c.count}</span>
              </li>
            ))}
          </ul>
          <Weakest factor={weakest} onAsk={onAsk} />
        </div>
        <ol className="space-y-2" aria-label={t("listLabel")}>
          {rows.map((f, i) => (
            <FactorRow key={f.key} factor={f} weakest={f.key === health.weakest} index={i} onAsk={onAsk} />
          ))}
        </ol>
      </div>
      <p className="text-xs text-pretty text-fg-3">{t("footnote")}</p>
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
  const score = health.score;
  const limits = BALANCE.companyHealth.status;
  const status: HealthStatus =
    score >= limits.good ? "good" : score >= limits.ok ? "ok" : score >= limits.weak ? "weak" : "critical";
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 label-pixel text-fg-2">
          <PixelIcon {...UI_ICONS.star} scale={1} />
          {t("title")}
          <InfoTip text={t("info")} label={t("title")} />
        </p>
        <p className="mt-1 text-sm text-pretty text-fg-3">{t("intro")}</p>
      </div>
      <div className="flex items-stretch gap-2">
        <div className="rounded-md bg-surface-2 px-3 py-2 text-right" data-testid="health-score">
          <p className="text-2xs text-fg-3">{t("scoreLabel")}</p>
          <p className={cn("nums text-lg font-semibold", TONE[status].text)}>
            {score}
            <span className="text-xs font-normal text-fg-3"> / 100</span>
          </p>
          <p className="sr-only">{t("score", { score })}</p>
          {health.estimated && <p className="text-2xs text-info">{t("estimatedBadge")}</p>}
        </div>
        <div className="rounded-md bg-surface-2 px-3 py-2 text-right">
          <ProfitNow cents={health.profitPerHourCents} />
        </div>
      </div>
    </div>
  );
}

function ProfitNow({ cents, small }: { cents: number; small?: boolean }) {
  const t = useTranslations("companyHealth");
  return (
    <span className="block" data-testid="health-profit">
      {!small && (
        <span className="block text-2xs text-fg-3" aria-hidden>
          {t(cents >= 0 ? "profitNow" : "lossNow")}
        </span>
      )}
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
          <p className="text-sm text-pretty text-fg-1">
            <span className="font-semibold">{t("doThis")}</span> {t(`todo.${factor.key}`)}
          </p>
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
  const limits = BALANCE.companyHealth.status;
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.slow, ease: EASE.out, delay: index * STAGGER }}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-md border bg-surface-2 px-3 py-3",
        weakest ? "border-line-2 ring-1 ring-line-2" : "border-line-1",
      )}
      data-testid="health-factor"
      data-factor={factor.key}
      data-status={factor.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-fg-1">{text.factor(factor.key)}</span>
          <span className="rounded-xs bg-surface-3 px-1.5 py-0.5 text-2xs text-fg-3">
            {t(`link.${STRENGTH_OF[factor.key]}`)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className={cn("rounded-pill px-2 py-0.5 text-2xs font-medium", tone.soft, tone.text)}>
            {t(`status.${factor.status}`)}
          </span>
          <span className="nums text-sm font-semibold text-fg-1">
            {factor.score}
            <span className="text-xs font-normal text-fg-3">/100</span>
          </span>
        </span>
      </div>
      <div
        className="relative h-2 overflow-hidden rounded-pill bg-surface-3"
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
        {[limits.weak, limits.ok, limits.good].map((at) => (
          <span key={at} aria-hidden className="absolute inset-y-0 w-px bg-bg/70" style={{ left: `${at}%` }} />
        ))}
      </div>
      <p className="text-xs text-pretty text-fg-3">{t(`explain.${factor.key}`)}</p>
      <p className="text-sm text-pretty text-fg-2">{text.reason(factor)}</p>
      {factor.status !== "good" && (
        <p className="text-xs text-pretty text-fg-1">
          <span className="font-semibold">{t("doThis")}</span> {t(`todo.${factor.key}`)}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className={cn("nums text-xs", factor.impactCents > 0 ? "font-semibold text-gain" : "text-fg-3")}>
          {factor.impactCents > 0 ? t("impact", { amount: money(factor.impactCents) }) : t("noImpact")}
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
      {!compact &&
        [0.5, 1].map((ring) => (
          <text key={ring} x={CX + 3} y={CY - R * ring + 9} className="fill-fg-3 text-2xs" aria-hidden>
            {ring * 100}
          </text>
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
              className={cn("text-2xs", weakest ? "fill-fg-1 font-semibold" : "fill-fg-2")}
            >
              {text.factor(f.key)}
              <tspan className={cn("nums font-semibold", TONE[f.status].fill)} dx={4}>
                {f.score}
              </tspan>
            </text>
          );
        })}
    </svg>
  );
}
