"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { COIN, SECTOR_ICONS, type SectorKey } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Card } from "@/components/ui/card";
import { LockBadge } from "@/components/ui/lock-badge";
import { Segmented } from "@/components/ui/segmented";
import { useSecurities } from "@/features/game/hooks";
import { usePlayerLevel } from "@/features/game/store";
import { LockedFeature } from "@/features/progression/components/locked-feature";
import { emitTutorial } from "@/features/tutorial/store";
import { SPRING } from "@/lib/motion";
import { isUnlocked, unlockLevel } from "@/lib/sim/progression";
import { cn } from "@/lib/utils";
import { BondList } from "./bond-list";
import { IndexCard } from "./index-card";
import { SecurityRow, SecurityRowSkeleton } from "./security-row";

type AssetTab = "stocks" | "bonds" | "indices";
type SectorFilter = SectorKey | "all";
type SortKey = "name" | "movers";

const SECTORS = Object.keys(SECTOR_ICONS) as SectorKey[];
const BOND_LEVEL = unlockLevel("bonds") ?? 1;

export function MarketBrowser() {
  const t = useTranslations("markets");
  const ts = useTranslations("sectors");
  const level = usePlayerLevel();
  const [tab, setTab] = useState<AssetTab>("stocks");
  const [sector, setSector] = useState<SectorFilter>("all");
  const [sort, setSort] = useState<SortKey>("name");
  const stocks = useSecurities("stock");
  const bondsUnlocked = isUnlocked("bonds", level);

  const tickers = useMemo(() => {
    if (!stocks) return null;
    const list = sector === "all" ? stocks : stocks.filter((s) => s.sector === sector);
    const sorted =
      sort === "movers"
        ? [...list].sort((a, b) => Math.abs(b.changeBps) - Math.abs(a.changeBps))
        : [...list].sort((a, b) => a.name.localeCompare(b.name, "de"));
    return sorted.map((s) => s.ticker);
  }, [stocks, sector, sort]);

  return (
    <div className="space-y-4">
      <div data-tour="asset-tabs">
        <Segmented
          value={tab}
          onValueChange={(next) => {
            setTab(next);
            if (next === "bonds") emitTutorial("bonds-tab-opened");
          }}
          label={t("tabs")}
          block
          className="lg:inline-flex lg:w-auto"
          options={[
            { value: "stocks", label: t("stocks") },
            {
              value: "bonds",
              label: t("bonds"),
              adornment: bondsUnlocked ? undefined : <LockBadge level={BOND_LEVEL} />,
            },
            { value: "indices", label: t("indices") },
          ]}
        />
      </div>

      {tab === "stocks" && (
        <>
          <div
            role="group"
            aria-label={t("filter")}
            className="-mx-4 no-scrollbar flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0"
          >
            {(["all", ...SECTORS] as const).map((key) => {
              const active = sector === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSector(key)}
                  className={cn(
                    "flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 label-pixel focus-ring transition duration-fast ease-standard active:scale-[0.97]",
                    active
                      ? "border-accent bg-accent-soft text-fg-1"
                      : "border-line-1 bg-surface-1 text-fg-2 hover:border-line-2 hover:text-fg-1",
                  )}
                >
                  {key !== "all" && <PixelIcon {...SECTOR_ICONS[key]} scale={1} />}
                  {ts(key)}
                </button>
              );
            })}
          </div>

          <Card padding="lg">
            <div className="mb-1 flex items-center justify-between gap-3">
              <p className="label-pixel text-fg-3">{t("count", { count: tickers?.length ?? 0 })}</p>
              <Segmented
                value={sort}
                onValueChange={setSort}
                label={t("sort")}
                size="sm"
                options={[
                  { value: "name", label: t("sortName") },
                  { value: "movers", label: t("sortMovers") },
                ]}
              />
            </div>
            <ul className="lg:grid lg:grid-cols-2 lg:gap-x-10">
              {tickers === null &&
                Array.from({ length: 8 }, (_, i) => (
                  <li key={i}>
                    <SecurityRowSkeleton />
                  </li>
                ))}
              <AnimatePresence mode="popLayout" initial={false}>
                {tickers?.map((ticker) => (
                  <motion.li
                    key={ticker}
                    layout
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={SPRING.smooth}
                  >
                    <SecurityRow ticker={ticker} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </Card>
        </>
      )}

      {tab === "bonds" && (
        <div className="space-y-4">
          {!bondsUnlocked && (
            <LockedFeature
              level={BOND_LEVEL}
              title={t("bondsLockedTitle")}
              description={t("bondsLockedText")}
              art={<PixelIcon {...COIN} scale={3} />}
            />
          )}
          <BondList locked={!bondsUnlocked} />
        </div>
      )}
      {tab === "indices" && <IndexCard showMembers />}
    </div>
  );
}
