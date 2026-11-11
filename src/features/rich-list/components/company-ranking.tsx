"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { SECTOR_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { ShortMoney } from "@/components/ui/live-money";
import { Segmented } from "@/components/ui/segmented";
import { SkeletonRow } from "@/components/ui/skeleton";
import type { CompanyRankingEntry, RichListScope } from "@/features/game/types";
import { CompanyLogo } from "@/features/market/components/company-logo";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useCompanyRanking } from "../hooks";

const MEDALS = ["bg-gold text-on-semantic", "bg-fg-2 text-fg-inverse", "bg-warn text-on-semantic"] as const;

/** The most valuable companies (ADR-074): AI companies and player companies, or player companies only. */
export function CompanyRankingList() {
  const t = useTranslations("ranking");
  const [scope, setScope] = useState<RichListScope>("players");
  const list = useCompanyRanking(scope, 100);
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
      {!list.data && Array.from({ length: 8 }, (_, i) => <SkeletonRow key={i} />)}
      {list.data?.entries.length === 0 && <p className="py-6 text-center text-sm text-fg-3">{t("companyEmpty")}</p>}
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
        <p className="mt-3 border-t border-line-1 pt-3 text-sm text-fg-2">
          {t("companyMine", { rank: list.data.mine.rank })}
        </p>
      )}
    </div>
  );
}

function CompanyRow({ entry }: { entry: CompanyRankingEntry }) {
  const t = useTranslations("ranking");
  const tf = useTranslations("firm");
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md px-2 py-2.5",
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
        {entry.revenueCents !== null && (
          <span className="text-xs text-fg-3">
            {t("revenue")} <ShortMoney cents={entry.revenueCents} />
          </span>
        )}
      </span>
    </div>
  );
}
