"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { CARS, FURNITURE, type FurnitureCategory, type FurnitureTier } from "@/config/furniture";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import type { Property } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { logoArt } from "@/lib/sim/logo";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { usePropertyRefresh } from "../hooks";

const CATEGORIES: (FurnitureCategory | "all")[] = [
  "all",
  "seating",
  "tables",
  "beds",
  "kitchen",
  "bath",
  "rugs",
  "plants",
  "decor",
  "tech",
  "fun",
];
const TIERS: (FurnitureTier | "all")[] = ["all", "budget", "standard", "premium", "luxury", "ultra"];
export const TIER_STYLE: Record<FurnitureTier, string> = {
  budget: "bg-surface-3 text-fg-2",
  standard: "bg-info-soft text-info",
  premium: "bg-accent-soft text-accent",
  luxury: "bg-gold/20 text-gold",
  ultra: "bg-loss-soft text-loss",
};

/** The furniture store (ADR-082): every piece in five price classes, from cheap to ultra. */
export function FurnitureShop({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("estate");
  const errorText = useGameErrorText();
  const refresh = usePropertyRefresh();
  const cash = useGame((state) => state.portfolio?.cashCents ?? 0);
  const [category, setCategory] = useState<FurnitureCategory | "all">("all");
  const [tier, setTier] = useState<FurnitureTier | "all">("all");
  const [sort, setSort] = useState<"asc" | "desc">("asc");
  const [busy, setBusy] = useState<string | null>(null);
  const list = FURNITURE.filter(
    (f) => (category === "all" || f.category === category) && (tier === "all" || f.tier === tier),
  ).sort((a, b) => (sort === "asc" ? a.priceCents - b.priceCents : b.priceCents - a.priceCents));

  const buy = async (key: string, name: string, price: number) => {
    setBusy(key);
    try {
      await engine.buyFurniture(crypto.randomUUID(), key, 1);
      haptic("success");
      void playSound("coin");
      toast.success(t("bought"), `${name} · ${formatMoney(price, { whole: true })}`, { silent: true });
      await refresh();
    } catch (error) {
      toast.error(t("shopTitle"), errorText(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={t("shopTitle")} description={t("shopIntro")}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("category")}>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={category === c}
              onClick={() => setCategory(c)}
              className={cn(
                "rounded-pill px-3 py-1.5 text-xs focus-ring transition duration-fast active:scale-95",
                category === c ? "bg-accent text-on-accent" : "bg-surface-2 text-fg-2 hover:text-fg-1",
              )}
            >
              {t(`categories.${c}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<FurnitureTier | "all">
            value={tier}
            onValueChange={setTier}
            label={t("tier")}
            size="sm"
            options={TIERS.map((x) => ({ value: x, label: t(`tiers.${x}`) }))}
          />
          <Segmented<"asc" | "desc">
            value={sort}
            onValueChange={setSort}
            label={t("sort")}
            size="sm"
            options={[
              { value: "asc", label: t("sortAsc") },
              { value: "desc", label: t("sortDesc") },
            ]}
          />
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="shop">
          {list.map((f) => (
            <li
              key={f.key}
              className="flex flex-col gap-2 rounded-lg border border-line-1 bg-surface-1 p-3"
              data-item={f.key}
            >
              <div className="grid h-24 place-items-center rounded-md bg-surface-2">
                <PixelIcon {...logoArt(f.sprite)} scale={f.w > 3 || f.h > 2 ? 1 : 2} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-fg-1">{f.name}</p>
                <p className="text-2xs text-fg-3">
                  <span className={cn("mr-1.5 rounded-xs px-1 py-0.5 label-pixel", TIER_STYLE[f.tier])}>
                    {t(`tiers.${f.tier}`)}
                  </span>
                  {f.w}×{f.h}
                </p>
              </div>
              <Button
                size="sm"
                className="mt-auto"
                disabled={cash < f.priceCents || busy !== null}
                state={busy === f.key ? "loading" : "idle"}
                onClick={() => void buy(f.key, f.name, f.priceCents)}
              >
                {formatMoney(f.priceCents, { whole: true })}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

/** The car dealer (ADR-082): made-up brands, from city car to hypercar. */
export function CarDealer({ open, property, onClose }: { open: boolean; property: Property; onClose: () => void }) {
  const t = useTranslations("estate");
  const errorText = useGameErrorText();
  const refresh = usePropertyRefresh();
  const cash = useGame((state) => state.portfolio?.cashCents ?? 0);
  const [busy, setBusy] = useState<string | null>(null);
  const full = property.garage.length >= property.garageSlots;
  const buy = async (key: string, name: string) => {
    setBusy(key);
    try {
      await engine.buyCar(crypto.randomUUID(), key);
      haptic("success");
      void playSound("levelUp", 0.6);
      toast.success(t("carBought"), name);
      await refresh();
    } catch (error) {
      toast.error(t("dealerTitle"), errorText(error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={t("dealerTitle")} description={t("dealerIntro")}>
      {full && <p className="mb-3 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">{t("garageFullHint")}</p>}
      <ul className="grid gap-3 sm:grid-cols-2" data-testid="dealer">
        {[...CARS]
          .sort((a, b) => a.priceCents - b.priceCents)
          .map((c) => (
            <li
              key={c.key}
              className="flex items-center gap-3 rounded-lg border border-line-1 bg-surface-1 p-3"
              data-car={c.key}
            >
              <div className="grid h-20 w-36 shrink-0 place-items-center rounded-md bg-surface-2">
                <PixelIcon {...logoArt(c.sprite)} scale={2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-fg-3">{c.brand}</p>
                <p className="truncate font-semibold text-fg-1">{c.name}</p>
                <span className={cn("rounded-xs px-1 py-0.5 label-pixel text-2xs", TIER_STYLE[c.tier])}>
                  {t(`tiers.${c.tier}`)}
                </span>
              </div>
              <Button
                size="sm"
                disabled={full || cash < c.priceCents || busy !== null}
                state={busy === c.key ? "loading" : "idle"}
                onClick={() => void buy(c.key, `${c.brand} ${c.name}`)}
              >
                {formatMoney(c.priceCents, { whole: true })}
              </Button>
            </li>
          ))}
      </ul>
    </Modal>
  );
}
