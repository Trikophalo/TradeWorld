"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Candle } from "@/features/game/types";
import { PRICE_SCALE } from "@/lib/format";
import { prefersReducedMotion, useSettings } from "@/stores/settings";
import { cn } from "@/lib/utils";

export type ChartStyle = "area" | "candles";

export interface PriceChartProps {
  /** Candles in e4 prices, oldest first. */
  candles: Candle[] | undefined;
  /** Latest price in e4. Updates the newest candle without refetching. */
  liveE4?: number;
  chartStyle?: ChartStyle;
  /** Colours the area by direction. */
  positive: boolean;
  /** Accessible summary, e.g. "NEXA 30, 12.486 Punkte". */
  label: string;
  className?: string;
}

const priceFormat = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pennyFormat = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 4 });

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Lightweight Charts wants concrete colours, so translucent fills are built here. */
function withAlpha(color: string, alpha: number): string {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return color;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type Bar = { time: number; open: number; high: number; low: number; close: number };

interface ChartApi {
  setData: (bars: Bar[], style: ChartStyle) => void;
  updateLast: (bar: Bar, style: ChartStyle) => void;
  restyle: (positive: boolean) => void;
}

/**
 * Price chart on TradingView Lightweight Charts (Apache 2.0): area or candles.
 * The library is loaded on demand and its attribution logo stays visible, as
 * the licence asks. Colours come from the design tokens and follow theme changes.
 * The newest candle grows with every tick (`liveE4`) without a refetch.
 */
export function PriceChart({ candles, liveE4, chartStyle = "area", positive, label, className }: PriceChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const theme = useSettings((state) => state.theme);
  const accent = useSettings((state) => state.accent);
  const api = useRef<ChartApi | null>(null);
  const bars = useRef<Bar[]>([]);
  const latest = useRef({ positive, chartStyle });

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    let disposed = false;
    let cleanup = () => {};

    void import("lightweight-charts").then(
      ({ createChart, AreaSeries, CandlestickSeries, ColorType, CrosshairMode, LineStyle }) => {
        if (disposed) return;
        const chart = createChart(node, {
          autoSize: true,
          layout: {
            background: { type: ColorType.Solid, color: "transparent" },
            fontFamily: token("--font-sans"),
            fontSize: 11,
            attributionLogo: true,
          },
          rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
          timeScale: {
            borderVisible: false,
            timeVisible: true,
            secondsVisible: false,
            fixLeftEdge: true,
            fixRightEdge: true,
          },
          crosshair: { mode: CrosshairMode.Magnet },
          handleScale: false,
          handleScroll: false,
          localization: {
            locale: "de-DE",
            priceFormatter: (value: number) => (value < 1 ? pennyFormat : priceFormat).format(value),
          },
        });
        const area = chart.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
        const candle = chart.addSeries(CandlestickSeries, {
          priceLineVisible: false,
          lastValueVisible: true,
          borderVisible: false,
        });

        const restyle = (isPositive: boolean) => {
          const gain = token("--gain");
          const loss = token("--loss");
          const color = isPositive ? gain : loss;
          chart.applyOptions({
            layout: { textColor: token("--fg-3") },
            grid: { vertLines: { visible: false }, horzLines: { color: token("--line-1"), style: LineStyle.Dotted } },
            crosshair: {
              vertLine: { color: token("--line-2"), labelBackgroundColor: token("--bg-3") },
              horzLine: { color: token("--line-2"), labelBackgroundColor: token("--bg-3") },
            },
          });
          area.applyOptions({ lineColor: color, topColor: withAlpha(color, 0.28), bottomColor: withAlpha(color, 0) });
          candle.applyOptions({ upColor: gain, downColor: loss, wickUpColor: gain, wickDownColor: loss });
        };
        const toArea = (b: Bar) => ({ time: b.time, value: b.close });
        const setData = (list: Bar[], style: ChartStyle) => {
          area.applyOptions({ visible: style === "area" });
          candle.applyOptions({ visible: style === "candles" });
          area.setData(list.map(toArea) as Parameters<typeof area.setData>[0]);
          candle.setData(list as Parameters<typeof candle.setData>[0]);
          chart.timeScale().fitContent();
        };
        const updateLast = (bar: Bar) => {
          area.update(toArea(bar) as Parameters<typeof area.update>[0]);
          candle.update(bar as Parameters<typeof candle.update>[0]);
        };

        restyle(latest.current.positive);
        api.current = { setData, updateLast, restyle };
        if (bars.current.length) {
          setData(bars.current, latest.current.chartStyle);
          setReady(true);
        }
        cleanup = () => chart.remove();
      },
    );

    return () => {
      disposed = true;
      api.current = null;
      cleanup();
    };
  }, []);

  // New candle data (range switch, refetch) or a style change.
  useEffect(() => {
    latest.current = { positive, chartStyle };
    if (!candles) return;
    bars.current = candles.map((c) => ({
      time: c.time,
      open: c.open / PRICE_SCALE,
      high: c.high / PRICE_SCALE,
      low: c.low / PRICE_SCALE,
      close: c.close / PRICE_SCALE,
    }));
    if (api.current && bars.current.length) {
      api.current.restyle(positive);
      api.current.setData(bars.current, chartStyle);
      setReady(true);
    }
  }, [candles, chartStyle, positive]);

  // Live tick: the newest candle grows.
  useEffect(() => {
    const last = bars.current[bars.current.length - 1];
    if (!liveE4 || !last || !api.current) return;
    const price = liveE4 / PRICE_SCALE;
    const bar = { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) };
    bars.current[bars.current.length - 1] = bar;
    api.current.updateLast(bar, latest.current.chartStyle);
  }, [liveE4]);

  // Tokens change one frame after the setting does.
  useEffect(() => {
    const frame = requestAnimationFrame(() => api.current?.restyle(latest.current.positive));
    return () => cancelAnimationFrame(frame);
  }, [theme, accent]);

  return (
    <div className={cn("relative", className)} role="img" aria-label={label}>
      {!ready && <Skeleton className="absolute inset-0 rounded-md" />}
      <div
        ref={container}
        className={cn(
          "absolute inset-0 transition-opacity ease-out",
          !prefersReducedMotion() && "duration-slower",
          ready ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
