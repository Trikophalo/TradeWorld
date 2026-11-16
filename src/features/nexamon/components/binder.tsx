"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { NEXAMON_RARITIES, NEXAMON_SETS, type NexamonRarity, type NexamonSetKey } from "@/config/nexamon";
import { COIN } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import type { NexamonCollection } from "@/features/game/nexamon-types";
import { formatMoney, formatMoneyShort } from "@/lib/format";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { formatCardNumber } from "../lib";
import {
  BINDER_OWNERSHIPS,
  BINDER_SALES,
  BINDER_SORTS,
  binderEntries,
  collectionTotals,
  DEFAULT_BINDER_FILTER,
  groupBySet,
  type BinderEntry,
  type BinderFilter,
  type BinderOwnership,
  type BinderSale,
  type BinderSort,
  tileMoney,
} from "../view";
import { SetIcon } from "./badges";
import { CopyVisual, GradeChip, SelectField, Stat } from "./parts";

/**
 * The binder (ADR-165): every card of the three sets in number order. Owned cards show their best copy (a slab
 * once graded), missing ones stay grey with their number. Filters narrow it down, a tap opens the card.
 */
export function Binder({ collection }: { collection: NexamonCollection | undefined }) {
  const t = useTranslations("nexamon");
  const tc = useTranslations("nexamonCards");
  const [filter, setFilter] = useState<BinderFilter>(DEFAULT_BINDER_FILTER);
  const wide = useMediaQuery("(min-width: 1024px)");
  const scale = wide ? 2 : 1;
  const entries = useMemo(
    () => (collection ? binderEntries(collection.cards, collection.copies, filter) : []),
    [collection, filter],
  );
  const groups = useMemo(() => groupBySet(entries, filter.sort), [entries, filter.sort]);
  const patch = (next: Partial<BinderFilter>) => setFilter((current) => ({ ...current, ...next }));

  if (!collection) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full rounded-lg" />
        <div className="grid grid-cols-4 gap-2 lg:grid-cols-6">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="aspect-[72/100] rounded-sm" />
          ))}
        </div>
      </div>
    );
  }

  const totals = collectionTotals(collection.copies);
  return (
    <div className="space-y-4" data-testid="nexamon-binder">
      <div className="space-y-1">
        <h2 className="font-pixel text-sm text-fg-1 uppercase">{t("binder.title")}</h2>
        <p className="text-sm text-pretty text-fg-2" data-testid="binder-kept">
          {t("binder.keptHint", { listed: totals.listed, kept: totals.copies - totals.listed })}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label={t("binder.copies")} testId="binder-copies">
          {totals.copies}
        </Stat>
        <Stat label={t("binder.distinct")} testId="binder-distinct">
          {t("binder.distinctValue", { owned: totals.distinct, total: collection.cards.length })}
        </Stat>
        <Stat label={t("binder.value")} testId="binder-value">
          <span title={formatMoney(totals.valueCents)}>{formatMoneyShort(totals.valueCents)}</span>
        </Stat>
      </div>

      <div className="space-y-3 rounded-lg bg-surface-2 p-3">
        <Segmented<BinderOwnership>
          value={filter.ownership}
          onValueChange={(ownership) => patch({ ownership })}
          label={t("binder.ownership")}
          size="sm"
          block
          options={BINDER_OWNERSHIPS.map((value) => ({ value, label: t(`binder.own.${value}`) }))}
        />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <SelectField<NexamonSetKey | "all">
            label={t("filter.set")}
            value={filter.set}
            onChange={(set) => patch({ set })}
            testId="binder-set"
            options={[
              { value: "all", label: t("filter.allSets") },
              ...NEXAMON_SETS.map((set) => ({ value: set, label: tc(`sets.${set}`) })),
            ]}
          />
          <SelectField<NexamonRarity | "all">
            label={t("filter.rarity")}
            value={filter.rarity}
            onChange={(rarity) => patch({ rarity })}
            testId="binder-rarity"
            options={[
              { value: "all", label: t("filter.allRarities") },
              ...NEXAMON_RARITIES.map((rarity) => ({ value: rarity, label: tc(`rarityShort.${rarity}`) })),
            ]}
          />
          <SelectField<BinderSort>
            label={t("filter.sort")}
            value={filter.sort}
            onChange={(sort) => patch({ sort })}
            testId="binder-sort"
            options={BINDER_SORTS.map((sort) => ({ value: sort, label: t(`binder.sort.${sort}`) }))}
          />
          <SelectField<BinderSale>
            label={t("binder.saleLabel")}
            value={filter.sale}
            onChange={(sale) => patch({ sale })}
            testId="binder-sale"
            options={BINDER_SALES.map((sale) => ({ value: sale, label: t(`binder.sale.${sale}`) }))}
          />
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          art={<PixelIcon {...COIN} scale={4} />}
          title={t(totals.copies === 0 ? "binder.emptyTitle" : "binder.noMatchTitle")}
          description={t(totals.copies === 0 ? "binder.emptyText" : "binder.noMatchText")}
          action={
            totals.copies === 0 ? (
              <Link href="/nexamon?tab=shop" className="text-sm font-medium text-accent focus-ring hover:underline">
                {t("binder.toShop")}
              </Link>
            ) : undefined
          }
        />
      ) : (
        groups.map((group) => (
          <section key={group.set ?? "all"} className="space-y-2" data-set={group.set ?? "all"}>
            {group.set && (
              <h3 className="flex items-center justify-between gap-2">
                <SetIcon set={group.set} label className="font-pixel text-xs uppercase" />
                <span className="nums text-xs text-fg-3">
                  {t("binder.setCount", {
                    owned: group.entries.filter((e) => e.copies.length > 0).length,
                    total: group.entries.length,
                  })}
                </span>
              </h3>
            )}
            <ul
              className={cn(
                "grid items-end justify-between gap-x-1 gap-y-3",
                scale === 1 ? "grid-cols-[repeat(auto-fill,86px)]" : "grid-cols-[repeat(auto-fill,172px)]",
              )}
              data-testid="binder-grid"
            >
              {group.entries.map((entry) => (
                <BinderTile key={entry.stats.cardKey} entry={entry} scale={scale} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function BinderTile({ entry, scale }: { entry: BinderEntry; scale: number }) {
  const t = useTranslations("nexamon");
  const owned = entry.copies.length;
  const best = entry.copies[0];
  return (
    <li data-card={entry.stats.cardKey} data-owned={owned > 0} data-testid="binder-tile">
      <Link
        href={`/nexamon/${entry.stats.cardKey}`}
        aria-label={t("binder.tileLabel", { name: entry.card.name, count: owned })}
        className="group flex flex-col items-center gap-1 rounded-sm focus-ring"
      >
        <span className="relative block transition-transform duration-fast ease-out group-hover:-translate-y-0.5 group-active:scale-[0.97]">
          <CopyVisual
            card={entry.card}
            grade={best?.grade ?? null}
            serial={best?.serial}
            scale={scale}
            dimmed={owned === 0}
          />
          {owned > 1 && (
            <span
              className="absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-pill bg-accent-strong px-1 nums text-2xs font-semibold text-on-accent shadow-1"
              data-testid="tile-count"
            >
              ×{owned}
            </span>
          )}
        </span>
        <span className="flex w-full items-center justify-center gap-1 nums text-2xs text-fg-3">
          {formatCardNumber(entry.stats.number).slice(0, 3)}
          {owned > 0 ? (
            <span className="font-medium text-fg-1">{tileMoney(best?.valueCents ?? entry.stats.valueCents)}</span>
          ) : (
            <span>{t("binder.missing")}</span>
          )}
        </span>
        {scale > 1 && entry.bestGrade !== null && <GradeChip grade={entry.bestGrade} short />}
      </Link>
    </li>
  );
}
