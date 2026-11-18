"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useMemo, useState, type ReactNode } from "react";
import { nexamonCard, type NexamonRarity } from "@/config/nexamon";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { NexamonPackResult, NexamonPull } from "@/features/game/nexamon-types";
import { formatBps, formatMoney } from "@/lib/format";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { isHit } from "../lib";
import { summarizePacks } from "../view";
import { RarityBadge } from "./badges";
import { CardThumb } from "./card-face";
import { InstantSell, type InstantSellItem } from "./instant-sell";
import "./nexamon.css";

type RarityFilter = "all" | NexamonRarity;

/**
 * ADR-204: the result of several packs opened at once ("Alle aufdecken"). The verdict stays on top while scrolling
 * (worth against price, big and green or red), then the best hits, every card in a compact grid by value with a
 * rarity filter, the totals per pack (folded), and the instant sale of ADR-196 for all fresh pulls.
 */
export function MultiPackSummary({
  packs,
  instantItems,
  children,
}: {
  packs: readonly NexamonPackResult[];
  /** What the instant sale offers (ADR-196); default every pull. Packs seen one by one before had their own offer. */
  instantItems?: readonly InstantSellItem[];
  children?: ReactNode;
}) {
  const t = useTranslations("nexamon.multi");
  const summary = useMemo(() => summarizePacks(packs), [packs]);
  const [filter, setFilter] = useState<RarityFilter>("all");
  const [perPack, setPerPack] = useState(false);
  const shown = filter === "all" ? summary.sorted : summary.sorted.filter((c) => c.rarity === filter);
  const up = summary.profitCents >= 0;
  const items = useMemo(() => instantItems ?? packs.flatMap((p) => p.cards), [instantItems, packs]);

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4" data-testid="pack-result" data-multi="true">
      {/* The verdict: sticks to the top of the popup while the cards scroll by. */}
      <div
        className="sticky top-0 z-10 -mx-4 border-b-2 border-line-1 bg-bg px-4 pt-1 pb-3 lg:-mx-6 lg:px-6"
        data-testid="multi-verdict"
        data-up={up}
      >
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <p className="font-pixel text-sm text-fg-1 uppercase" data-testid="pack-all-title">
              {t("title", { count: packs.length })}
            </p>
            <p className="mt-0.5 nums text-xs text-fg-2">
              {t("line", {
                worth: formatMoney(summary.valueCents),
                paid: formatMoney(summary.paidCents, { whole: true }),
              })}
            </p>
          </div>
          <div className="text-right">
            <p
              className={cn("nums text-3xl leading-none font-semibold lg:text-4xl", up ? "text-gain" : "text-loss")}
              data-testid="multi-profit"
            >
              {formatMoney(summary.profitCents, { sign: true })}
            </p>
            <p className={cn("mt-1 nums text-xs font-medium", up ? "text-gain" : "text-loss")}>
              {t("return", { pct: formatBps(summary.returnBps) })}
            </p>
          </div>
        </div>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
          <Stat label={t("worth")} value={formatMoney(summary.valueCents)} testId="pack-worth" />
          <Stat label={t("cards")} value={String(summary.count)} />
          <Stat label={t("fresh")} value={String(summary.fresh)} />
        </dl>
      </div>

      {/* The best hits, big. */}
      {summary.best.length > 0 && (
        <section aria-labelledby="multi-best" className="space-y-2">
          <h3 id="multi-best" className="label-pixel text-fg-2">
            {t("best")}
          </h3>
          <ul className="grid grid-cols-3 gap-2" data-testid="multi-best">
            {summary.best.map((pull, i) => (
              <motion.li
                key={pull.copyId}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: DURATION.slow, ease: EASE.out, delay: i * 0.08 }}
              >
                <BestHit pull={pull} rank={i + 1} />
              </motion.li>
            ))}
          </ul>
        </section>
      )}

      {/* Every card, best first, with a rarity filter. */}
      <section aria-labelledby="multi-all" className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 id="multi-all" className="label-pixel text-fg-2">
            {t("all")}
          </h3>
          <span className="nums text-xs text-fg-3">{t("sorted")}</span>
        </div>
        <div
          className="-mx-4 no-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-1"
          role="group"
          aria-label={t("filter")}
        >
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")} testId="multi-filter-all">
            {t("filterAll", { count: summary.count })}
          </FilterChip>
          {summary.rarities.map((r) => (
            <FilterChip
              key={r.rarity}
              active={filter === r.rarity}
              onClick={() => setFilter(r.rarity)}
              testId={`multi-filter-${r.rarity}`}
            >
              <RarityBadge rarity={r.rarity} short />
              <span className="nums">{r.count}</span>
            </FilterChip>
          ))}
        </div>
        {shown.length === 0 ? (
          <EmptyState
            art={<PixelIcon {...UI_ICONS.card} scale={3} />}
            title={t("emptyTitle")}
            description={t("emptyText")}
          />
        ) : (
          <ul
            className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-x-1.5 gap-y-3"
            data-testid="multi-grid"
          >
            <AnimatePresence initial={false}>
              {shown.map((pull) => (
                <motion.li
                  key={pull.copyId}
                  layout="position"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: DURATION.base, ease: EASE.out }}
                >
                  <PullTile pull={pull} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </section>

      {/* Totals per pack, folded. */}
      <section className="rounded-lg border-2 border-line-1 bg-surface-1">
        <button
          type="button"
          aria-expanded={perPack}
          onClick={() => setPerPack((open) => !open)}
          className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-fg-1 focus-ring transition-colors duration-fast hover:bg-surface-2 active:bg-surface-3"
          data-testid="multi-per-pack-toggle"
        >
          <span>{t("perPack")}</span>
          <span aria-hidden className={cn("transition-transform duration-fast", perPack && "rotate-180")}>
            ▾
          </span>
        </button>
        {perPack && (
          <ul className="divide-y divide-line-1 border-t-2 border-line-1" data-testid="multi-per-pack">
            {summary.packs.map((p) => (
              <li key={p.packId} className="flex items-center gap-3 px-3 py-2" data-testid="multi-pack-row">
                <span className="w-14 shrink-0 label-pixel text-fg-3">{t("packN", { n: p.index })}</span>
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  {p.best && <RarityBadge rarity={p.best.rarity} short />}
                  <span className="truncate text-xs text-fg-2">
                    {p.best ? (nexamonCard(p.best.cardKey)?.name ?? p.best.cardKey) : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block nums text-sm font-semibold text-fg-1">{formatMoney(p.valueCents)}</span>
                  <span className={cn("block nums text-2xs", p.profitCents >= 0 ? "text-gain" : "text-loss")}>
                    {formatMoney(p.profitCents, { sign: true })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <InstantSell key={packs[0]?.packId ?? "none"} items={items} />
      {children}
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-md bg-surface-2 px-2 py-1.5">
      <dt className="label-pixel text-fg-3">{label}</dt>
      <dd className="nums text-sm font-semibold text-fg-1" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border-2 px-2 text-xs font-medium focus-ring transition-colors duration-fast active:scale-[0.98]",
        active
          ? "border-accent bg-surface-2 text-fg-1"
          : "border-line-1 bg-surface-1 text-fg-2 hover:bg-surface-2 hover:text-fg-1",
      )}
    >
      {children}
    </button>
  );
}

/** One of the best hits: the card with its glow, the value and the rarity. */
function BestHit({ pull, rank }: { pull: NexamonPull; rank: number }) {
  const t = useTranslations("nexamon");
  const card = nexamonCard(pull.cardKey);
  if (!card) return null;
  return (
    <Dialog.Close asChild>
      <Link
        href={`/nexamon/${pull.cardKey}`}
        className="group flex flex-col items-center gap-1 rounded-md border-2 border-line-1 bg-surface-1 px-1 py-2 text-center focus-ring transition-colors duration-fast hover:bg-surface-2"
        data-testid="multi-best-hit"
        data-rank={rank}
        data-card={pull.cardKey}
      >
        <span className="relative">
          {isHit(pull.rarity) && (
            <span
              aria-hidden
              className={cn("nexamon-glow-pulse absolute -inset-3 opacity-80", `nexamon-glow-${pull.rarity}`)}
            />
          )}
          <span className="relative block transition-transform duration-fast group-hover:-translate-y-0.5">
            <CardThumb card={card} scale={1} />
          </span>
        </span>
        <span className="w-full truncate text-xs font-medium text-fg-1">{card.name}</span>
        <RarityBadge rarity={pull.rarity} short />
        <span className="nums text-sm font-semibold text-gold">{formatMoney(pull.valueCents)}</span>
        {pull.isNew && <Badge tone="gain">{t("new")}</Badge>}
      </Link>
    </Dialog.Close>
  );
}

/** A card of the grid: small, value under it, a dot when it is new. */
function PullTile({ pull }: { pull: NexamonPull }) {
  const t = useTranslations("nexamon");
  const card = nexamonCard(pull.cardKey);
  if (!card) return null;
  return (
    <Dialog.Close asChild>
      <Link
        href={`/nexamon/${pull.cardKey}`}
        className="group flex flex-col items-center gap-0.5 rounded-xs focus-ring"
        data-testid="pull-row"
        data-card={pull.cardKey}
        data-new={pull.isNew}
        data-rarity={pull.rarity}
        aria-label={t("multi.tile", { name: card.name, value: formatMoney(pull.valueCents) })}
      >
        <span className="relative transition-transform duration-fast group-hover:-translate-y-0.5">
          <CardThumb card={card} scale={1} />
          {pull.isNew && (
            <span className="absolute -top-1 -right-1 rounded-xs bg-gain px-1 text-2xs font-semibold text-on-accent">
              {t("new")}
            </span>
          )}
        </span>
        <span className={cn("nums text-2xs font-semibold", isHit(pull.rarity) ? "text-accent" : "text-fg-2")}>
          {formatMoney(pull.valueCents)}
        </span>
      </Link>
    </Dialog.Close>
  );
}
