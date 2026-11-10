"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { COIN, SECTOR_ICONS, type SectorKey } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { DEMO_COMPANIES } from "@/lib/demo/market";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { SecurityRow } from "./security-row";

type AssetTab = "stocks" | "bonds" | "indices";
type SectorFilter = SectorKey | "all";

const SECTORS = Object.keys(SECTOR_ICONS) as SectorKey[];

export function MarketBrowser() {
  const t = useTranslations("markets");
  const ts = useTranslations("sectors");
  const [tab, setTab] = useState<AssetTab>("stocks");
  const [sector, setSector] = useState<SectorFilter>("all");

  const companies = sector === "all" ? DEMO_COMPANIES : DEMO_COMPANIES.filter((c) => c.sector === sector);

  return (
    <div className="space-y-4">
      <Segmented
        value={tab}
        onValueChange={setTab}
        label={t("tabs")}
        block
        className="lg:inline-flex lg:w-auto"
        options={[
          { value: "stocks", label: t("stocks") },
          { value: "bonds", label: t("bonds") },
          { value: "indices", label: t("indices") },
        ]}
      />

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
            <p className="mb-1 label-pixel text-fg-3">{t("count", { count: companies.length })}</p>
            <ul className="lg:grid lg:grid-cols-2 lg:gap-x-10">
              <AnimatePresence mode="popLayout" initial={false}>
                {companies.map((company) => (
                  <motion.li
                    key={company.ticker}
                    layout
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={SPRING.smooth}
                  >
                    <SecurityRow company={company} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </Card>
        </>
      )}

      {tab === "bonds" && (
        <Card>
          <EmptyState
            art={<PixelIcon {...COIN} scale={4} />}
            title={t("bondsEmptyTitle")}
            description={t("bondsEmptyText")}
          />
        </Card>
      )}
      {tab === "indices" && (
        <Card>
          <EmptyState
            art={<PixelIcon {...SECTOR_ICONS.tech} scale={4} />}
            title={t("indicesEmptyTitle")}
            description={t("indicesEmptyText")}
          />
        </Card>
      )}
    </div>
  );
}
