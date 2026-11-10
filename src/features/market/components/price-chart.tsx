"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { DemoPoint } from "@/lib/demo/market";
import { prefersReducedMotion, useSettings } from "@/stores/settings";
import { cn } from "@/lib/utils";

export interface PriceChartProps {
  data: DemoPoint[];
  /** Colours the line by direction. */
  positive: boolean;
  /** Accessible summary, e.g. "NEXA 30, 12.486 Punkte". */
  label: string;
  className?: string;
}

const priceFormat = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

/**
 * Area chart on TradingView Lightweight Charts (Apache 2.0). The library is
 * loaded on demand and its attribution logo stays visible, as the licence asks.
 * Colours come from the design tokens and follow theme changes.
 */
export function PriceChart({ data, positive, label, className }: PriceChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const theme = useSettings((state) => state.theme);
  const accent = useSettings((state) => state.accent);
  const latest = useRef({ data, positive });
  const api = useRef<{ setData: (points: DemoPoint[], positive: boolean) => void; restyle: () => void } | null>(null);

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    let disposed = false;
    let cleanup = () => {};

    void import("lightweight-charts").then(({ createChart, AreaSeries, ColorType, CrosshairMode, LineStyle }) => {
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
        localization: { locale: "de-DE", priceFormatter: (value: number) => priceFormat.format(value) },
      });
      const series = chart.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: true });

      const restyle = () => {
        const color = token(latest.current.positive ? "--gain" : "--loss");
        chart.applyOptions({
          layout: { textColor: token("--fg-3") },
          grid: { vertLines: { visible: false }, horzLines: { color: token("--line-1"), style: LineStyle.Dotted } },
          crosshair: {
            vertLine: { color: token("--line-2"), labelBackgroundColor: token("--bg-3") },
            horzLine: { color: token("--line-2"), labelBackgroundColor: token("--bg-3") },
          },
        });
        series.applyOptions({ lineColor: color, topColor: withAlpha(color, 0.28), bottomColor: withAlpha(color, 0) });
      };
      const setData = (points: DemoPoint[]) => {
        series.setData(points as Parameters<typeof series.setData>[0]);
        chart.timeScale().fitContent();
      };

      restyle();
      setData(latest.current.data);
      api.current = {
        setData: (points) => {
          restyle();
          setData(points);
        },
        restyle,
      };
      setReady(true);
      cleanup = () => chart.remove();
    });

    return () => {
      disposed = true;
      api.current = null;
      cleanup();
    };
  }, []);

  useEffect(() => {
    latest.current = { data, positive };
    api.current?.setData(data, positive);
  }, [data, positive]);

  // Tokens change one frame after the setting does.
  useEffect(() => {
    const frame = requestAnimationFrame(() => api.current?.restyle());
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
