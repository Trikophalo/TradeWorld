"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { NEWSPAPER } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useProductText } from "@/features/company/product-name";
import { engine } from "@/features/game/store";
import type { NewsFeedItem, NewsFeedKind } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { fadeUp, staggerContainer } from "@/lib/motion";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const FILTERS: readonly NewsFeedKind[] = ["all", "stock", "company", "market", "fun"];
const KIND_TONE = { stock: "accent", company: "info", market: "neutral", fun: "warn" } as const;

/**
 * The news tab (ADR-129): stock hints, what happens in the players' companies (tasks, records, IPOs), market news
 * and funny items, newest first.
 */
export function NewsFeed() {
  const t = useTranslations("newsTab");
  const [kind, setKind] = useState<NewsFeedKind>("all");
  const feed = useQuery({
    queryKey: ["news-feed", kind],
    queryFn: () => engine.newsFeed(kind, 50),
    refetchInterval: 45_000,
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4" data-testid="news-feed">
      <Segmented
        value={kind}
        onValueChange={setKind}
        options={FILTERS.map((f) => ({ value: f, label: t(`filters.${f}`) }))}
        label={t("title")}
        block
      />
      {!feed.data ? (
        <div className="space-y-3" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : feed.data.length === 0 ? (
        <Card padding="lg">
          <EmptyState art={<PixelIcon {...NEWSPAPER} scale={4} />} title={t("empty")} description={t("emptyText")} />
        </Card>
      ) : (
        <motion.ul className="space-y-3" variants={staggerContainer} initial="hidden" animate="visible" key={kind}>
          {feed.data.map((item) => (
            <motion.li key={item.id} variants={fadeUp}>
              <NewsCard item={item} />
            </motion.li>
          ))}
        </motion.ul>
      )}
    </div>
  );
}

function useAgo() {
  const t = useTranslations("newsTab");
  const now = useClock();
  return (iso: string) => {
    if (now === null) return "";
    const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
    return minutes < 60 ? t("ago", { minutes }) : t("agoHours", { hours: Math.floor(minutes / 60) });
  };
}

/** Fills {placeholders} without ICU, for texts picked at runtime. */
function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");
}

function useNewsText() {
  const tn = useTranslations("companyNews");
  const tk = useTranslations("companyTasks.items");
  const tfun = useTranslations("funNews.items");
  const tf = useTranslations("firm.tiers");
  const product = useProductText();
  return (item: NewsFeedItem): { headline: string; body: string | null } => {
    if (item.kind === "stock" || item.kind === "market") return { headline: item.headline ?? "", body: item.body };
    if (item.kind === "fun") {
      const path = (item.itemKey ?? "") as Parameters<typeof tfun>[0];
      const raw = item.itemKey && tfun.has(path) ? String(tfun.raw(path)) : "";
      return {
        headline: fill(raw, { company: item.name ?? "", ticker: item.ticker ?? "", nickname: item.nickname ?? "" }),
        body: null,
      };
    }
    // company news: a task result has its own line, everything else uses the company news templates
    if (item.headline) return { headline: item.headline, body: null };
    const p = item.payload;
    const company = item.name ?? "";
    if (item.newsKind?.startsWith("task_") && typeof p.task === "string") {
      const path = `${p.task}.${item.newsKind === "task_success" ? "ok" : "fail"}` as Parameters<typeof tk>[0];
      const line = tk.has(path) ? fill(String(tk.raw(path)), { company }) : "";
      const amount = typeof p.amount_cents === "number" ? p.amount_cents : 0;
      return {
        headline: line,
        body: amount === 0 ? null : `${amount > 0 ? "+" : "−"}${formatMoney(Math.abs(amount), { whole: true })}`,
      };
    }
    const kindPath = `kinds.${item.newsKind}` as Parameters<typeof tn>[0];
    const templates = item.newsKind && tn.has(kindPath) ? (tn.raw(kindPath) as unknown) : [];
    const list = Array.isArray(templates) ? (templates as string[]) : [];
    if (list.length === 0) return { headline: company, body: null };
    const seed = [...item.id].reduce((a, c) => a + c.charCodeAt(0), 0);
    const tier = typeof p.tier === "string" ? p.tier : (item.tier ?? "");
    return {
      headline: fill(list[seed % list.length]!, {
        company,
        product: item.product ? product.name(item.product) : "",
        tier: ["garage", "small_business", "gmbh", "ag"].includes(tier) ? tf(tier as "garage") : "",
        level: String(p.level ?? ""),
        ticker: String(p.ticker ?? ""),
        nickname: String(p.nickname ?? ""),
        title: String(p.title ?? ""),
        outcome: String(p.outcome ?? ""),
        profit: typeof p.profit_cents === "number" ? formatMoney(p.profit_cents, { whole: true }) : "",
      }),
      body: null,
    };
  };
}

function NewsCard({ item }: { item: NewsFeedItem }) {
  const t = useTranslations("newsTab");
  const text = useNewsText()(item);
  const ago = useAgo();
  const negative = item.kind === "company" && (item.newsKind === "task_failure" || item.newsKind === "task_missed");
  const positive = item.kind === "company" && item.newsKind === "task_success";
  return (
    <Card padding="md" className="space-y-2" data-kind={item.kind}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={KIND_TONE[item.kind]}>{t(`kinds.${item.kind}`)}</Badge>
        {item.kind === "stock" && item.direction && (
          <Badge tone={item.direction === "up" ? "gain" : "loss"}>{t(item.direction)}</Badge>
        )}
        {item.ticker && item.kind !== "fun" && <Badge>{item.ticker}</Badge>}
        <span className="ml-auto text-2xs text-fg-3">{ago(item.at)}</span>
      </div>
      <p className="text-sm font-semibold text-pretty text-fg-1">{text.headline}</p>
      {text.body && (
        <p
          className={cn("text-xs text-pretty", negative ? "nums text-loss" : positive ? "nums text-gain" : "text-fg-2")}
        >
          {text.body}
        </p>
      )}
      {item.kind === "stock" && item.ticker && (
        <Link
          href={`/markets/${item.ticker}`}
          className="inline-block text-2xs font-semibold text-accent focus-ring hover:underline"
        >
          {item.ticker} →
        </Link>
      )}
    </Card>
  );
}
