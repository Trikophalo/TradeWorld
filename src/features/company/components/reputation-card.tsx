"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { BALANCE } from "@/config/balance";
import type { ListedCompany } from "@/features/game/listed-types";
import type { CompanyReputation, MyCompany } from "@/features/game/types";
import { formatBps } from "@/lib/format";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Panel } from "../listed/shared";

/*
 * The reputation of the company (ADR-183): every company has one now. The value, where it is heading, what it does
 * to the demand (and for listed companies to the fair share price), what moved it in the last closed hour and its
 * course over the last two days.
 */

const OPERATIONAL = ["quality", "delivery", "price", "wages", "bills", "crisis", "campaign"] as const;
const LISTED = ["items", "greed", "reinvest", "dividends", "scandal"] as const;
type DriverKey = (typeof OPERATIONAL)[number] | (typeof LISTED)[number];

const pct = (factor: number) => formatBps(Math.round((factor - 1) * 10_000));
const points = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1).replace(".", ",")}`;
const tone = (v: number) => (v >= 60 ? "gain" : v >= 40 ? "info" : v >= 25 ? "warn" : "loss");
const TEXT = { gain: "text-gain", info: "text-info", warn: "text-warn", loss: "text-loss" } as const;
const BAR = { gain: "bg-gain", info: "bg-info", warn: "bg-warn", loss: "bg-loss" } as const;

/** The reputation as the page has it: from the company (every company), else from the listed state. */
export function reputationOf(company: MyCompany, listed: ListedCompany | null): CompanyReputation | null {
  if (company.reputation) return company.reputation;
  if (!listed) return null;
  return {
    value: listed.reputation.value,
    target: listed.reputation.target,
    demandFactor: listed.reputation.demandFactor,
    drivers: listed.reputation.drivers,
    at: null,
    history: listed.history.map((h) => ({ hourStart: h.at, value: h.reputation, target: h.reputation })),
  };
}

export function ReputationCard({ company, listed }: { company: MyCompany; listed: ListedCompany | null }) {
  const t = useTranslations("hq.reputation");
  const r = reputationOf(company, listed);
  if (!r) {
    return (
      <Panel title={t("title")} description={t("description")} testId="company-reputation">
        <p className="text-sm text-pretty text-fg-3">{t("noServer")}</p>
      </Panel>
    );
  }
  const value = Math.round(r.value);
  const target = Math.round(r.target);
  const heading = r.target > r.value + 0.5 ? "up" : r.target < r.value - 0.5 ? "down" : "steady";
  const base = r.drivers.base ?? BALANCE.companyHealth.reputation.base;
  const keys: DriverKey[] = [...OPERATIONAL, ...(listed ? LISTED : [])];
  const rows = keys.map((k) => ({ key: k, value: r.drivers[k] ?? 0 }));
  const active = rows.filter((x) => Math.abs(x.value) >= 0.05).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const neutral = rows.filter((x) => Math.abs(x.value) < 0.05);
  const max = Math.max(5, ...active.map((x) => Math.abs(x.value)));
  return (
    <Panel
      title={t("title")}
      description={t("description")}
      info={t("info", { rate: Math.round(BALANCE.companyHealth.reputation.adjustPerHour * 100) })}
      id="reputation"
      testId="company-reputation"
    >
      <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
        <div>
          <p className="flex items-baseline gap-2" data-testid="reputation-value">
            <span className={cn("nums text-4xl font-semibold", TEXT[tone(r.value)])}>{value}</span>
            <span className="text-sm text-fg-3">/ 100</span>
            <span className="nums text-sm text-fg-2" data-testid="reputation-target">
              {heading === "up" ? "↗" : heading === "down" ? "↘" : "→"} {target}
            </span>
          </p>
          <div
            className="relative mt-2 h-2.5 overflow-hidden rounded-pill bg-surface-3"
            role="meter"
            aria-label={t("title")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={value}
          >
            <motion.span
              className={cn("block h-full origin-left rounded-pill", BAR[tone(r.value)])}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: Math.min(1, Math.max(0, r.value / 100)) }}
              transition={{ duration: DURATION.slow, ease: EASE.out }}
            />
            <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-fg-3" />
          </div>
          <p className="mt-1.5 text-xs text-pretty text-fg-3">{t(`heading.${heading}`, { target })}</p>
        </div>
        <dl className="grid grid-cols-2 gap-2">
          <div className="rounded-md bg-surface-2 px-3 py-2">
            <dt className="text-xs text-fg-3">{t("demand")}</dt>
            <dd
              className={cn("nums font-semibold", r.demandFactor >= 1 ? "text-gain" : "text-loss")}
              data-testid="reputation-demand"
            >
              {pct(r.demandFactor)}
            </dd>
          </div>
          {listed ? (
            <div className="rounded-md bg-surface-2 px-3 py-2">
              <dt className="text-xs text-fg-3">{t("price")}</dt>
              <dd className={cn("nums font-semibold", listed.reputation.priceFactor >= 1 ? "text-gain" : "text-loss")}>
                {pct(listed.reputation.priceFactor)}
              </dd>
            </div>
          ) : (
            <div className="rounded-md bg-surface-2 px-3 py-2">
              <dt className="text-xs text-fg-3">{t("base")}</dt>
              <dd className="nums font-semibold text-fg-1">{Math.round(base)}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-fg-1">
          {r.at ? t("driversTitle", { base: Math.round(base) }) : t("driversWaiting")}
        </p>
        {active.length === 0 ? (
          <p className="text-sm text-pretty text-fg-3" data-testid="reputation-calm">
            {t("calm")}
          </p>
        ) : (
          <ul className="space-y-1.5" data-testid="reputation-drivers">
            {active.map((d) => (
              <li key={d.key} className="rounded-md bg-surface-2 px-3 py-2" data-driver={d.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 text-fg-1">{t(`drivers.${d.key}.name`)}</span>
                  <span className={cn("shrink-0 nums font-semibold", d.value > 0 ? "text-gain" : "text-loss")}>
                    {points(d.value)}
                  </span>
                </div>
                <div className="relative mt-1 h-1 rounded-pill bg-surface-3" aria-hidden>
                  <span
                    className={cn(
                      "absolute inset-y-0 w-1/2 rounded-pill",
                      d.value > 0 ? "left-1/2 origin-left bg-gain" : "right-1/2 origin-right bg-loss",
                    )}
                    style={{ transform: `scaleX(${Math.min(1, Math.abs(d.value) / max)})` }}
                  />
                </div>
                <p className="mt-1 text-xs text-pretty text-fg-3">{t(`drivers.${d.key}.text`)}</p>
              </li>
            ))}
          </ul>
        )}
        {neutral.length > 0 && (
          <p className="text-xs text-pretty text-fg-3">
            {t("neutral", { list: neutral.map((d) => t(`drivers.${d.key}.name`)).join(", ") })}
          </p>
        )}
      </div>
      <ReputationHistory history={r.history} label={t("history")} />
    </Panel>
  );
}

/** The value and its target over the last hours as a small line chart (SVG, tokens). */
function ReputationHistory({ history, label }: { history: CompanyReputation["history"]; label: string }) {
  const t = useTranslations("hq.reputation");
  if (history.length < 2) {
    return <p className="text-xs text-pretty text-fg-3">{t("historyEmpty")}</p>;
  }
  const W = 320;
  const H = 80;
  const lo = Math.max(0, Math.min(...history.map((h) => Math.min(h.value, h.target))) - 5);
  const hi = Math.min(100, Math.max(...history.map((h) => Math.max(h.value, h.target))) + 5);
  const x = (i: number) => (i / (history.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / Math.max(1, hi - lo)) * H;
  const line = (pick: (h: (typeof history)[number]) => number) =>
    history.map((h, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(pick(h)).toFixed(1)}`).join(" ");
  const first = history[0]!;
  const last = history.at(-1)!;
  return (
    <figure className="space-y-1">
      <figcaption className="flex items-baseline justify-between gap-2 text-xs text-fg-3">
        <span>{label}</span>
        <span className="nums">
          {Math.round(first.value)} → {Math.round(last.value)}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t("historyLabel", {
          from: Math.round(first.value),
          to: Math.round(last.value),
          hours: history.length,
        })}
        className="block h-20 w-full"
        data-testid="reputation-history"
      >
        {lo < 50 && hi > 50 && (
          <line x1={0} x2={W} y1={y(50)} y2={y(50)} className="stroke-line-2" strokeDasharray="3 3" strokeWidth={1} />
        )}
        <path d={line((h) => h.target)} className="fill-none stroke-fg-3" strokeDasharray="4 3" strokeWidth={1.5} />
        <path d={line((h) => h.value)} className="fill-none stroke-accent" strokeWidth={2} strokeLinejoin="round" />
      </svg>
      <p className="flex gap-3 text-2xs text-fg-3">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="h-0.5 w-3 rounded-pill bg-accent" /> {t("legendValue")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="h-0.5 w-3 rounded-pill bg-fg-3" /> {t("legendTarget")}
        </span>
      </p>
    </figure>
  );
}
