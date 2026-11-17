"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { nexamonCard } from "@/config/nexamon";
import { COIN } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/format";
import { nexamonIsBlackLabel } from "@/lib/sim/nexamon";
import { cn } from "@/lib/utils";
import { tileMoney } from "../view";
import { CopyVisual, GradeChip } from "./parts";

/** A slab as the "Nur gegradete" view needs it (own binder and other players' collections, ADR-171). */
export interface SlabItem {
  id: string;
  cardKey: string;
  serial: number;
  grade: number;
  valueCents: number;
}

/** Slabs first by grade, then by value. */
export function sortSlabs<T extends { grade: number; valueCents: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.grade - a.grade || b.valueCents - a.valueCents);
}

/** The slabs of a collection with a small summary: how many, how many tens, how many Black Labels. */
export function SlabList({
  items,
  scale = 1,
  linkCards = true,
}: {
  items: SlabItem[];
  scale?: number;
  linkCards?: boolean;
}) {
  const t = useTranslations("nexamon");
  const sorted = sortSlabs(items);
  if (sorted.length === 0)
    return (
      <EmptyState
        art={<PixelIcon {...COIN} scale={4} />}
        title={t("slabs.emptyTitle")}
        description={t("slabs.emptyText")}
      />
    );
  return (
    <div className="space-y-3" data-testid="slab-list">
      <p className="nums text-sm text-fg-2" data-testid="slab-summary">
        {t("slabs.summary", {
          count: sorted.length,
          tens: sorted.filter((s) => s.grade >= 10).length,
          black: sorted.filter((s) => nexamonIsBlackLabel(s.grade)).length,
        })}
      </p>
      <ul
        className={cn(
          "grid items-end justify-between gap-x-1 gap-y-3",
          scale === 1 ? "grid-cols-[repeat(auto-fill,86px)]" : "grid-cols-[repeat(auto-fill,172px)]",
        )}
      >
        {sorted.map((s) => {
          const card = nexamonCard(s.cardKey);
          if (!card) return null;
          const label = t("slabs.label", {
            name: card.name,
            grade: nexamonIsBlackLabel(s.grade)
              ? t("blackLabel.long")
              : t("gradeShort", { grade: String(s.grade).replace(".", ",") }),
            value: formatMoney(s.valueCents),
          });
          const body = (
            <>
              <CopyVisual card={card} grade={s.grade} serial={s.serial} scale={scale} />
              <span className="nums text-2xs font-medium text-fg-1">{tileMoney(s.valueCents)}</span>
              <GradeChip grade={s.grade} short />
            </>
          );
          return (
            <li key={s.id} data-testid="slab-tile" data-card={s.cardKey} data-grade={s.grade}>
              {linkCards ? (
                <Link
                  href={`/nexamon/${s.cardKey}`}
                  aria-label={label}
                  className="flex flex-col items-center gap-1 rounded-sm focus-ring transition-transform duration-fast hover:-translate-y-0.5"
                >
                  {body}
                </Link>
              ) : (
                <span aria-label={label} className="flex flex-col items-center gap-1">
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
