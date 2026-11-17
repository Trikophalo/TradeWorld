"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { BALANCE } from "@/config/balance";
import type { CompanyStrengths, MyCompany } from "@/features/game/types";
import { formatBps } from "@/lib/format";
import { DURATION, EASE } from "@/lib/motion";
import { STRENGTH_KEYS, type StrengthKey } from "@/lib/sim/company-strengths";
import { cn } from "@/lib/utils";

/*
 * Company strengths (ADR-176): six slow scores as a spider chart with the reward they pay. 100 takes days of good
 * hours; every tier pays a bonus on the hour's revenue.
 */

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

const tone = (score: number) => (score >= 75 ? "gain" : score >= 50 ? "info" : score >= 25 ? "warn" : "loss");
const FILL = { gain: "fill-gain", info: "fill-info", warn: "fill-warn", loss: "fill-loss" } as const;
const BAR = { gain: "bg-gain", info: "bg-info", warn: "bg-warn", loss: "bg-loss" } as const;

export function StrengthsRadar({ strengths }: { strengths: CompanyStrengths }) {
  const t = useTranslations("companyStrengths");
  const n = STRENGTH_KEYS.length;
  const shares = STRENGTH_KEYS.map((k) => Math.max(0.04, strengths.scores[k] / 100));
  const summary = STRENGTH_KEYS.map((k) => `${t(`keys.${k}`)} ${Math.floor(strengths.scores[k])}`).join(", ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${t("title")}: ${summary}`}
      className="mx-auto block h-auto w-full max-w-[340px]"
      data-testid="strengths-radar"
    >
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon
          key={ring}
          points={polygon(Array.from({ length: n }, () => ring))}
          className={cn("fill-none", ring === 1 ? "stroke-line-2" : "stroke-line-1")}
          strokeWidth={1}
        />
      ))}
      {STRENGTH_KEYS.map((k, i) => {
        const [x, y] = point(i, n, 1);
        return <line key={k} x1={CX} y1={CY} x2={x} y2={y} className="stroke-line-1" strokeWidth={1} />;
      })}
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
        {STRENGTH_KEYS.map((k, i) => {
          const [x, y] = point(i, n, shares[i]!);
          return (
            <circle
              key={k}
              cx={x}
              cy={y}
              r={3.5}
              className={cn(FILL[tone(strengths.scores[k])], "stroke-surface-1")}
              strokeWidth={1.5}
            />
          );
        })}
      </motion.g>
      {STRENGTH_KEYS.map((k, i) => {
        const [x, y] = point(i, n, 1, R + 12);
        const dx = x - CX;
        const anchor = Math.abs(dx) < 4 ? "middle" : dx > 0 ? "start" : "end";
        const dy = y < CY - R + 4 ? -4 : y > CY + R - 4 ? 12 : 4;
        return (
          <text key={k} x={x} y={y + dy} textAnchor={anchor} className="fill-fg-2 text-2xs">
            {t(`keys.${k}`)}
            <tspan className="fill-fg-3 nums" dx={4}>
              {Math.floor(strengths.scores[k])}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}

function Row({ k, score }: { k: StrengthKey; score: number }) {
  const t = useTranslations("companyStrengths");
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-fg-1">{t(`keys.${k}`)}</span>
        <span className="nums text-fg-2">{Math.floor(score)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <motion.div
          className={cn("h-full w-full origin-left rounded-full", BAR[tone(score)])}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: Math.max(0, Math.min(1, score / 100)) }}
          transition={{ duration: DURATION.slow, ease: EASE.out }}
        />
      </div>
      <p className="text-2xs text-pretty text-fg-3">{t(`hints.${k}`)}</p>
    </li>
  );
}

/** The card on the dashboard: chart, the reward now and the next tier, the six scores with what lifts them. */
export function StrengthsCard({ company }: { company: MyCompany }) {
  const t = useTranslations("companyStrengths");
  const s = company.strengths;
  if (!s) return null;
  const tiers = BALANCE.companyHealth.strengths.rewards;
  const overall = Math.floor(s.overall);
  return (
    <Card padding="lg" className="space-y-4" data-testid="company-strengths">
      <div className="flex items-start gap-3">
        <PixelIcon {...UI_ICONS.star} scale={2} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-fg-1">{t("title")}</p>
          <p className="text-xs text-pretty text-fg-3">{t("intro")}</p>
        </div>
        <span className="nums text-2xl font-semibold text-fg-1" data-testid="strengths-overall">
          {overall}
          <span className="text-sm font-normal text-fg-3"> / 100</span>
        </span>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="space-y-3">
          <StrengthsRadar strengths={s} />
          <div className="rounded-md bg-surface-2 px-3 py-2.5" data-testid="strengths-reward">
            <p className="text-2xs text-fg-3">{t("reward")}</p>
            <p className={cn("nums font-semibold", s.rewardBps > 0 ? "text-gain" : "text-fg-2")}>
              {s.rewardBps > 0 ? t("rewardNow", { percent: formatBps(s.rewardBps).replace("+", "") }) : t("rewardNone")}
            </p>
            {s.next && (
              <p className="text-xs text-fg-3">
                {t("rewardNext", { at: s.next.at, percent: formatBps(s.next.bps).replace("+", "") })}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label={t("tiers")}>
            {tiers.map((tier) => (
              <Badge key={tier.at} tone={overall >= tier.at ? "gain" : "neutral"}>
                {t("tier", { at: tier.at, percent: formatBps(tier.bps).replace("+", "") })}
              </Badge>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <ul className="grid gap-3 sm:grid-cols-2">
            {STRENGTH_KEYS.map((k) => (
              <Row key={k} k={k} score={s.scores[k]} />
            ))}
          </ul>
          <p className="text-xs text-pretty text-fg-3">{t("slow", { hours: s.hours })}</p>
        </div>
      </div>
    </Card>
  );
}

/** The hourly close of this company fails on the server: said plainly, with the server's words. */
export function CloseErrorNote({ company }: { company: MyCompany }) {
  const t = useTranslations("companyStrengths");
  const e = company.strengths?.closeError;
  if (!e) return null;
  return (
    <p className="rounded-md bg-loss-soft px-3 py-2.5 text-sm text-pretty text-loss" data-testid="close-error">
      {t("closeError", { failures: e.failures })} <span className="font-mono text-xs break-all">{e.error}</span>
    </p>
  );
}
