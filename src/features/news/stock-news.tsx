"use client";

import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { engine } from "@/features/game/store";
import type { StockNewsItem } from "@/features/game/types";
import { formatBps } from "@/lib/format";
import { SPRING, STAGGER } from "@/lib/motion";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const SHOWN = 6;

export function useStockNews() {
  return useQuery({ queryKey: ["stock-news"], queryFn: () => engine.stockNews(12), refetchInterval: 30_000 });
}

/**
 * Stock news with a lead (ADR-119): hints that a stock is about to rise or fall, with the time the move is expected
 * and, afterwards, whether it came true. Open hints first.
 */
export function StockNewsCard() {
  const t = useTranslations("stockNews");
  const news = useStockNews();
  const data = news.data;
  const items = data
    ? [...data.items].sort((a, b) => Number(b.status === "open") - Number(a.status === "open")).slice(0, SHOWN)
    : [];
  return (
    <Card padding="lg" className="space-y-3" data-testid="stock-news">
      <div>
        <h2 className="label-pixel text-fg-2">{t("title")}</h2>
        {data ? (
          <p className="mt-1 text-sm text-pretty text-fg-3">
            {t("intro", { percent: Math.round(data.reliabilityBps / 100) })}
          </p>
        ) : (
          <Skeleton className="mt-1.5 h-4 w-2/3 rounded-sm" />
        )}
      </div>
      {!data ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-16 w-full rounded-md" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-fg-2">{t("empty")}</p>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2">
          {items.map((item, i) => (
            <NewsRow key={item.id} item={item} index={i} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function NewsRow({ item, index }: { item: StockNewsItem; index: number }) {
  const t = useTranslations("stockNews");
  const reduced = useReducedMotion();
  const now = useClock();
  const up = item.direction === "up";
  const open = item.status === "open";
  const minutes = now === null ? null : Math.max(0, Math.round((Date.parse(item.dueAt) - now) / 60_000));
  return (
    <motion.li
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING.smooth, delay: reduced ? 0 : index * STAGGER }}
    >
      <Link
        href={`/markets/${item.ticker}`}
        aria-label={t("open", { ticker: item.ticker })}
        data-status={item.status}
        data-ticker={item.ticker}
        className={cn(
          "flex h-full items-start gap-3 rounded-md border-2 bg-surface-2 p-3 focus-ring transition duration-fast hover:-translate-y-0.5 active:translate-y-0",
          open ? (up ? "border-gain" : "border-loss") : "border-line-1 opacity-75",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-sm font-pixel text-base",
            up ? "bg-gain-soft text-gain" : "bg-loss-soft text-loss",
            open && "motion-safe:animate-float",
          )}
        >
          {up ? "▲" : "▼"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge>{item.ticker}</Badge>
            {open ? (
              <Badge tone={up ? "gain" : "loss"}>
                {t(up ? "up" : "down")} · {t("strength", { strength: item.strength })}
              </Badge>
            ) : item.status === "confirmed" ? (
              <Badge tone={up ? "gain" : "loss"}>{t("confirmed", { move: formatBps(item.moveBps ?? 0) })}</Badge>
            ) : (
              <Badge tone="warn">{t("fizzled")}</Badge>
            )}
          </span>
          <span className="mt-1 block text-sm font-medium text-pretty text-fg-1">{item.headline}</span>
          {open && (
            <span className="mt-0.5 block nums text-xs text-fg-3">
              {minutes === null ? " " : minutes === 0 ? t("any") : t("soon", { minutes })}
            </span>
          )}
        </span>
      </Link>
    </motion.li>
  );
}
