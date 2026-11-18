"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { SECTOR_ICONS, type SectorKey } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Delta } from "@/components/ui/delta";
import { EmptyState } from "@/components/ui/empty-state";
import { ShortMoney } from "@/components/ui/live-money";
import { Segmented } from "@/components/ui/segmented";
import { SkeletonRow } from "@/components/ui/skeleton";
import type { CompanyRankingEntry, RichListScope } from "@/features/game/types";
import { CompanyLogo } from "@/features/market/components/company-logo";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useCompanyRanking } from "../hooks";
import { RankingColumns, RankMove } from "./ranking-parts";

const MEDALS = ["bg-gold text-on-semantic", "bg-fg-2 text-fg-inverse", "bg-warn text-on-semantic"] as const;
const SECTORS: readonly SectorKey[] = ["tech", "retail", "energy", "pharma", "logistics"];

/**
 * The most valuable companies (ADR-074, ADR-203): player companies, or with the listed AI companies, optionally one
 * sector. Every company at company_worth_cents: listed at market cap, private at the company value its page shows.
 * The rank stays the rank in the whole list when a sector is picked.
 */
export function CompanyRankingList() {
  const t = useTranslations("ranking");
  const [scope, setScope] = useState<RichListScope>("players");
  const [sector, setSector] = useState<SectorKey | null>(null);
  const list = useCompanyRanking(scope, 100, sector);
  const mineVisible = list.data?.entries.some((e) => e.isMine);
  return (
    <div data-testid="company-ranking">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={scope}
          onValueChange={setScope}
          label={t("companyScope")}
          size="sm"
          options={[
            { value: "players", label: t("companyScopePlayers") },
            { value: "all", label: t("companyScopeAll") },
          ]}
        />
        <span className="text-xs text-fg-3">{t("companyHint")}</span>
      </div>
      <SectorFilter value={sector} onChange={setSector} />
      <RankingColumns name={t("colCompany")} value={t("colValue")} />
      {!list.data && Array.from({ length: 8 }, (_, i) => <SkeletonRow key={i} />)}
      {list.data?.entries.length === 0 &&
        (sector ? (
          <EmptyState
            art={<PixelIcon {...SECTOR_ICONS[sector]} scale={4} />}
            title={t("sectorEmptyTitle")}
            description={t("sectorEmpty")}
          />
        ) : (
          <p className="py-6 text-center text-sm text-fg-3">{t("companyEmpty")}</p>
        ))}
      <ol className="space-y-1">
        <AnimatePresence initial={false}>
          {list.data?.entries.map((entry) => (
            <motion.li key={entry.companyId} layout transition={SPRING.smooth}>
              <CompanyRow entry={entry} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
      {list.data?.mine && !mineVisible && (
        <div className="mt-3 border-t border-line-1 pt-3" data-testid="company-mine-pinned">
          <p className="mb-1 px-2 label-pixel text-fg-3">{t("companyMine", { rank: list.data.mine.rank })}</p>
          <CompanyRow entry={list.data.mine} />
        </div>
      )}
    </div>
  );
}

/** Branche: all or one sector, as wrapping chips (no horizontal scroll on a phone). */
function SectorFilter({ value, onChange }: { value: SectorKey | null; onChange: (s: SectorKey | null) => void }) {
  const t = useTranslations("ranking");
  const ts = useTranslations("sectors");
  const chip = (active: boolean) =>
    cn(
      "inline-flex h-8 items-center gap-1.5 rounded-pill border px-3 text-xs font-medium focus-ring transition-colors duration-fast active:scale-95 motion-reduce:active:scale-100",
      active
        ? "border-accent bg-accent-soft text-fg-1"
        : "border-line-1 bg-surface-1 text-fg-2 hover:bg-surface-2 hover:text-fg-1",
    );
  return (
    <div role="group" aria-label={t("sector")} className="mb-3 flex flex-wrap gap-1.5" data-testid="sector-filter">
      <button
        type="button"
        aria-pressed={value === null}
        className={chip(value === null)}
        onClick={() => onChange(null)}
      >
        {ts("all")}
      </button>
      {SECTORS.map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          className={chip(value === key)}
          onClick={() => onChange(value === key ? null : key)}
          data-sector={key}
        >
          <PixelIcon {...SECTOR_ICONS[key]} scale={1} />
          {ts(key)}
        </button>
      ))}
    </div>
  );
}

export function CompanyRow({ entry }: { entry: CompanyRankingEntry }) {
  const t = useTranslations("ranking");
  const tf = useTranslations("firm");
  return (
    <Link
      href={entry.isMine ? "/company" : `/companies/${encodeURIComponent(entry.companyId)}`}
      data-company={entry.companyId}
      className={cn(
        "flex items-center gap-3 rounded-md px-2 py-2.5 focus-ring",
        entry.isMine ? "bg-accent-soft ring-1 ring-accent" : "transition-colors duration-fast hover:bg-surface-2",
      )}
    >
      <span
        className={cn(
          "grid h-7 min-w-9 shrink-0 place-items-center rounded-xs px-1 font-pixel nums text-xs",
          entry.rank <= 3 ? MEDALS[entry.rank - 1] : "bg-surface-3 text-fg-2",
        )}
      >
        {entry.rank}
      </span>
      <CompanyLogo ticker={entry.ticker ?? entry.name} color={entry.color} logo={entry.logo} scale={2} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium text-fg-1">{entry.name}</span>
          {entry.isMine && <span className="shrink-0 label-pixel text-accent">{t("yours")}</span>}
        </span>
        <span className="flex items-center gap-1.5 truncate text-sm text-fg-3">
          {entry.sector && <PixelIcon {...SECTOR_ICONS[entry.sector]} scale={1} />}
          {entry.kind === "player"
            ? [
                entry.founder ? t("foundedBy", { name: entry.founder }) : null,
                entry.tier ? tf(`tiers.${entry.tier}`) : null,
                entry.teamSize ? tf("teamSize", { count: entry.teamSize }) : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : t("aiCompany")}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <ShortMoney cents={entry.valueCents} className="font-semibold text-fg-1" />
        <span className="flex items-center gap-2 text-xs text-fg-3">
          <span data-basis={entry.basis}>{t(`basis.${entry.basis}`)}</span>
          <RankMove moved={entry.rankChange24h} />
          {entry.change24hBps !== null && <Delta bps={entry.change24hBps} className="text-xs" />}
        </span>
        {entry.revenueCents !== null && (
          <span className="text-xs text-fg-3">
            {t("revenue")} <ShortMoney cents={entry.revenueCents} />
          </span>
        )}
      </span>
    </Link>
  );
}
