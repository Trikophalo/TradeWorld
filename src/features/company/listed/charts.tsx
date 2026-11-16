"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import type { ListedHistoryPoint } from "@/features/game/listed-types";
import { formatMoneyShort } from "@/lib/format";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { gaugeAngle, gaugeArc, gaugePoint, historyLine, linePath } from "./view";

/*
 * Charts of the company page (ADR-167, UI). Plain SVG with token colours: zones are green / yellow / red from the
 * gain / warn / loss tokens, every chart has labelled axes and a text alternative. Only transforms are animated.
 */

const ZONE = {
  green: { stroke: "stroke-gain", fill: "fill-gain", text: "text-gain" },
  yellow: { stroke: "stroke-warn", fill: "fill-warn", text: "text-warn" },
  red: { stroke: "stroke-loss", fill: "fill-loss", text: "text-loss" },
} as const;

export function zoneOf(value: number, green: number, red: number): keyof typeof ZONE {
  return value >= green ? "green" : value < red ? "red" : "yellow";
}

/** Half-circle gauge with a red, yellow and green zone; the needle shows the value, the notch the target. */
export function ZoneGauge({
  value,
  target,
  green,
  red,
  label,
  zoneLabel,
  size = "lg",
  className,
}: {
  value: number;
  /** Where the value is heading (optional notch on the arc). */
  target?: number;
  green: number;
  red: number;
  label: string;
  zoneLabel: string;
  size?: "sm" | "lg";
  className?: string;
}) {
  const t = useTranslations("hq.charts");
  const cx = 100;
  const cy = 100;
  const r = 80;
  const zone = zoneOf(value, green, red);
  const shown = Math.round(value);
  const notch = target === undefined ? null : [gaugePoint(target, cx, cy, r - 12), gaugePoint(target, cx, cy, r + 12)];
  return (
    <figure
      className={cn("mx-auto w-full", size === "lg" ? "max-w-[300px]" : "max-w-[190px]", className)}
      data-testid="zone-gauge"
      data-zone={zone}
    >
      <svg
        viewBox="0 0 200 118"
        role="img"
        aria-label={t("gaugeLabel", { label, value: shown, zone: zoneLabel })}
        className="block h-auto w-full"
      >
        <path d={gaugeArc(0, red, cx, cy, r)} className="fill-none stroke-loss" strokeWidth={14} />
        <path d={gaugeArc(red, green, cx, cy, r)} className="fill-none stroke-warn" strokeWidth={14} />
        <path d={gaugeArc(green, 100, cx, cy, r)} className="fill-none stroke-gain" strokeWidth={14} />
        {/* Gaps between the zones, in the surface colour */}
        {[red, green].map((v) => {
          const a = gaugePoint(v, cx, cy, r - 9);
          const b = gaugePoint(v, cx, cy, r + 9);
          return <line key={v} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-surface-1" strokeWidth={3} />;
        })}
        {[0, red, green, 100].map((v) => {
          const p = gaugePoint(v, cx, cy, r - 20);
          return (
            <text key={v} x={p.x} y={p.y + 3} textAnchor="middle" className="fill-fg-3 nums text-[9px]">
              {v}
            </text>
          );
        })}
        {notch && (
          <line
            x1={notch[0]!.x}
            y1={notch[0]!.y}
            x2={notch[1]!.x}
            y2={notch[1]!.y}
            className="stroke-fg-1"
            strokeWidth={2}
            strokeDasharray="3 2"
          />
        )}
        {/* The needle turns around the hub; the transparent square keeps the hub as the origin. */}
        <motion.g
          initial={false}
          animate={{ rotate: gaugeAngle(value) }}
          transition={SPRING.smooth}
          style={{ transformOrigin: `${cx}px ${cy}px`, transformBox: "view-box" }}
        >
          <path d={`M ${cx - 4} ${cy} L ${cx} ${cy - r + 16} L ${cx + 4} ${cy} Z`} className="fill-fg-1" />
        </motion.g>
        <circle cx={cx} cy={cy} r={7} className="fill-fg-1 stroke-surface-1" strokeWidth={2} />
      </svg>
      <figcaption className="-mt-1 text-center">
        <span className={cn("nums font-semibold", size === "lg" ? "text-4xl" : "text-2xl", ZONE[zone].text)}>
          {shown}
        </span>
        <span className="nums text-sm text-fg-3"> / 100</span>
        <span className={cn("mt-0.5 block label-pixel", ZONE[zone].text)}>{zoneLabel}</span>
      </figcaption>
    </figure>
  );
}

export interface HistorySeries {
  key: string;
  label: string;
  pick: (p: ListedHistoryPoint) => number;
  tone: "accent" | "info";
}

const SERIES_TONE = {
  accent: { stroke: "stroke-accent", fill: "fill-accent", dot: "bg-accent" },
  info: { stroke: "stroke-info", fill: "fill-info", dot: "bg-info" },
} as const;

/**
 * Values from 0 to 100 over the last hours, on top of the zones: the green band is where the first series should
 * stay. Y axis in points, X axis in hours before now.
 */
export function ZoneHistoryChart({
  history,
  series,
  green,
  red,
  label,
  className,
}: {
  history: readonly ListedHistoryPoint[];
  series: readonly HistorySeries[];
  green: number;
  red: number;
  label: string;
  className?: string;
}) {
  const t = useTranslations("hq.charts");
  const W = 320;
  const H = 150;
  const left = 26;
  const right = 34;
  const top = 8;
  const bottom = 20;
  const w = W - left - right;
  const h = H - top - bottom;
  const y = (v: number) => top + (1 - v / 100) * h;
  if (history.length < 2) {
    return <p className="rounded-md bg-surface-2 px-3 py-6 text-center text-sm text-fg-3">{t("historyEmpty")}</p>;
  }
  const first = Date.parse(history[0]!.at);
  const last = Date.parse(history[history.length - 1]!.at);
  const hours = Math.max(1, Math.round((last - first) / 3_600_000));
  const ticks = [...new Set([hours, Math.round((hours * 2) / 3), Math.round(hours / 3)])].filter((x) => x > 0);
  const lines = series.map((s) => ({ s, points: historyLine(history, s.pick, w, h), labelY: 0 }));
  // End labels must not sit on top of each other: push them apart when the lines end close together.
  const byEnd = [...lines].sort((a, b) => a.points[a.points.length - 1]!.y - b.points[b.points.length - 1]!.y);
  byEnd.forEach((line, i) => {
    const y = line.points[line.points.length - 1]!.y + 3;
    line.labelY = i === 0 ? y : Math.max(y, byEnd[i - 1]!.labelY + 11);
  });
  const summary = lines.map(({ s, points }) => `${s.label} ${Math.round(points[points.length - 1]!.value)}`).join(", ");
  return (
    <figure className={cn("w-full", className)} data-testid="zone-history">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t("historyLabel", { label, hours, summary })}
        className="block h-auto w-full"
      >
        <rect x={left} y={y(100)} width={w} height={y(green) - y(100)} className="fill-gain" fillOpacity={0.12} />
        <rect x={left} y={y(green)} width={w} height={y(red) - y(green)} className="fill-warn" fillOpacity={0.1} />
        <rect x={left} y={y(red)} width={w} height={y(0) - y(red)} className="fill-loss" fillOpacity={0.12} />
        {[0, red, green, 100].map((v) => (
          <g key={v}>
            <line
              x1={left}
              x2={left + w}
              y1={y(v)}
              y2={y(v)}
              className={v === green ? "stroke-gain" : v === red ? "stroke-loss" : "stroke-line-2"}
              strokeWidth={1}
              strokeDasharray={v === green || v === red ? "4 3" : undefined}
            />
            <text x={left - 5} y={y(v) + 3} textAnchor="end" className="fill-fg-3 nums text-[9px]">
              {v}
            </text>
          </g>
        ))}
        {ticks.map((ago) => {
          const x = left + (1 - ago / hours) * w;
          return (
            <text
              key={ago}
              x={x}
              y={H - 6}
              textAnchor={ago === hours ? "start" : "middle"}
              className="fill-fg-3 nums text-[9px]"
            >
              {t("hoursAgo", { hours: ago })}
            </text>
          );
        })}
        <text x={left + w} y={H - 6} textAnchor="end" className="fill-fg-3 text-[9px]">
          {t("now")}
        </text>
        {lines.map(({ s, points, labelY }) => {
          const end = points[points.length - 1]!;
          return (
            <g key={s.key} transform={`translate(${left} ${top})`}>
              <path
                d={linePath(points)}
                className={cn("fill-none", SERIES_TONE[s.tone].stroke)}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <circle
                cx={end.x}
                cy={end.y}
                r={3.5}
                className={cn(SERIES_TONE[s.tone].fill, "stroke-surface-1")}
                strokeWidth={1.5}
              />
              <text x={end.x + 7} y={labelY} className={cn("nums text-[10px] font-semibold", SERIES_TONE[s.tone].fill)}>
                {Math.round(end.value)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-3">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className={cn("h-0.5 w-4 rounded-pill", SERIES_TONE[s.tone].dot)} aria-hidden /> {s.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-xs bg-gain/30" aria-hidden /> {t("zoneGreen", { from: green })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-xs bg-loss/30" aria-hidden /> {t("zoneRed", { below: red })}
        </span>
      </figcaption>
    </figure>
  );
}

export interface HourBar {
  hourStart: string;
  revenueCents: number;
  profitCents: number;
}

/**
 * Revenue and costs per hour as paired bars, the profit as a line on the same scale. Y axis in money, X axis the
 * hour of the day.
 */
export function HoursChart({ hours, className }: { hours: readonly HourBar[]; className?: string }) {
  const t = useTranslations("hq.charts");
  const W = 320;
  const H = 160;
  const left = 44;
  const right = 6;
  const top = 8;
  const bottom = 20;
  const w = W - left - right;
  const h = H - top - bottom;
  if (hours.length === 0) {
    return <p className="rounded-md bg-surface-2 px-3 py-6 text-center text-sm text-fg-3">{t("hoursEmpty")}</p>;
  }
  const rows = hours.map((x) => ({ ...x, costsCents: Math.max(0, x.revenueCents - x.profitCents) }));
  const max = Math.max(1, ...rows.map((r) => Math.max(r.revenueCents, r.costsCents, r.profitCents)));
  const min = Math.min(0, ...rows.map((r) => r.profitCents));
  const span = max - min;
  const y = (v: number) => top + ((max - v) / span) * h;
  const slot = w / rows.length;
  const bar = Math.max(2, Math.min(9, slot / 2 - 1.5));
  const profit = rows.map((r, i) => ({ x: left + slot * (i + 0.5), y: y(r.profitCents), r }));
  const every = Math.ceil(rows.length / 6);
  const lastRow = rows[rows.length - 1]!;
  return (
    <figure className={cn("w-full", className)} data-testid="hours-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t("hoursLabel", {
          count: rows.length,
          revenue: formatMoneyShort(lastRow.revenueCents),
          costs: formatMoneyShort(lastRow.costsCents),
          profit: formatMoneyShort(lastRow.profitCents),
        })}
        className="block h-auto w-full"
      >
        {[max, max / 2, 0, ...(min < 0 ? [min] : [])].map((v) => (
          <g key={v}>
            <line
              x1={left}
              x2={left + w}
              y1={y(v)}
              y2={y(v)}
              className={v === 0 ? "stroke-line-2" : "stroke-line-1"}
              strokeWidth={1}
            />
            <text x={left - 5} y={y(v) + 3} textAnchor="end" className="fill-fg-3 nums text-[9px]">
              {formatMoneyShort(v)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = left + slot * (i + 0.5);
          const hour = new Date(r.hourStart).getHours();
          return (
            <g key={r.hourStart}>
              <title>
                {t("hourTitle", {
                  hour,
                  revenue: formatMoneyShort(r.revenueCents),
                  costs: formatMoneyShort(r.costsCents),
                  profit: formatMoneyShort(r.profitCents),
                })}
              </title>
              <rect
                x={x - bar - 0.5}
                y={y(r.revenueCents)}
                width={bar}
                height={Math.max(0, y(0) - y(r.revenueCents))}
                className="fill-accent"
                rx={1}
              />
              <rect
                x={x + 0.5}
                y={y(r.costsCents)}
                width={bar}
                height={Math.max(0, y(0) - y(r.costsCents))}
                className="fill-fg-3"
                fillOpacity={0.55}
                rx={1}
              />
              {i % every === 0 && (
                <text x={x} y={H - 6} textAnchor="middle" className="fill-fg-3 nums text-[9px]">
                  {t("hourOfDay", { hour })}
                </text>
              )}
            </g>
          );
        })}
        <path
          d={profit.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")}
          className="fill-none stroke-fg-1"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        {profit.map((p) => (
          <circle
            key={p.r.hourStart}
            cx={p.x}
            cy={p.y}
            r={2.5}
            className={cn(p.r.profitCents >= 0 ? "fill-gain" : "fill-loss", "stroke-surface-1")}
            strokeWidth={1}
          />
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-xs bg-accent" aria-hidden /> {t("revenue")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-xs bg-fg-3/60" aria-hidden /> {t("costs")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-pill bg-gain" aria-hidden />
          <span className="size-2 rounded-pill bg-loss" aria-hidden /> {t("profitLine")}
        </span>
      </figcaption>
    </figure>
  );
}
