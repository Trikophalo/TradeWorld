"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  ALARM_CLOCK,
  BOOK,
  COIN,
  GEARS,
  GRADUATE,
  KEY,
  PALETTE,
  SPEECH,
  VAULT_DOOR,
  WALLET,
} from "@/components/pixel/art";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { Card } from "@/components/ui/card";
import { HoldButton } from "@/components/ui/hold-button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useCareerRefresh } from "@/features/career/hooks";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import type { UpgradeKey } from "@/features/game/types";
import { formatBps, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { upgradeCheck, upgradeCostCents, upgradeStageLevel, upgradeValue } from "@/lib/sim/upgrades";
import { cn } from "@/lib/utils";
import { useSetUpgrades, useUpgrades } from "../hooks";

const ICONS: Record<UpgradeKey, PixelArt> = {
  vault: VAULT_DOOR,
  income: COIN,
  study: BOOK,
  overtime: ALARM_CLOCK,
  rhetoric: SPEECH,
  mentor: GRADUATE,
  artist: PALETTE,
  efficiency: GEARS,
  makler: KEY,
  crypto_wallet: WALLET,
};

const PIXEL_FRAME = "rounded-xs border-2 [box-shadow:0_4px_0_0_var(--line-2)]";

/** Biggest integer scale that keeps the icon at about 48 px. */
const iconScale = (art: PixelArt) => Math.max(1, Math.floor(48 / art.grid[0]!.length));

/**
 * The upgrade shop (ADR-093): every upgrade shows what it does now and after the next level, its levels as pixel
 * pips and the price. Buying needs a short hold, so nothing is bought by accident.
 */
export function UpgradeShop() {
  const t = useTranslations("upgrades");
  const upgrades = useUpgrades();
  const cash = useGame((s) => s.portfolio?.cashCents ?? 0);

  return (
    <div className="space-y-4">
      <Card padding="md" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="label-pixel text-fg-3">{t("cashLabel")}</p>
        <p className="nums text-lg font-semibold text-fg-1" data-testid="upgrades-cash">
          {formatMoney(cash)}
        </p>
        <p className="w-full text-xs text-pretty text-fg-3">{t("moneyNote")}</p>
      </Card>
      {upgrades.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {BALANCE.upgrades.order.map((key) => (
            <Skeleton key={key} className="h-56 w-full rounded-xs" />
          ))}
        </div>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {BALANCE.upgrades.order.map((key) => (
            <li key={key}>
              <UpgradeCard upgradeKey={key} level={upgrades.data?.levels[key] ?? 0} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function useValueText() {
  const t = useTranslations("upgrades.items");
  return (key: UpgradeKey, level: number) => {
    const value = upgradeValue(key, level);
    switch (key) {
      case "vault":
        return t("vault.value", { value });
      case "income":
        return t("income.value", { amount: formatMoney(value, { whole: true }) });
      case "study":
        return t("study.value", { value });
      case "overtime":
        return t("overtime.value", { value });
      case "rhetoric":
        return t("rhetoric.value", { percent: formatBps(value) });
      case "mentor":
      case "artist":
      case "efficiency":
      case "makler":
      case "crypto_wallet":
        return t(`${key}.value`, { percent: formatBps(value).replace("+", "") });
    }
  };
}

export function UpgradeCard({ upgradeKey: key, level }: { upgradeKey: UpgradeKey; level: number }) {
  const t = useTranslations("upgrades");
  const ti = useTranslations("upgrades.items");
  const valueText = useValueText();
  const errorText = useGameErrorText();
  const reduced = useReducedMotion();
  const setUpgrades = useSetUpgrades();
  const refreshCareer = useCareerRefresh();
  const refreshPortfolio = useGame((s) => s.refreshPortfolio);
  const cash = useGame((s) => s.portfolio?.cashCents ?? 0);
  const playerLevel = useGame((s) => s.portfolio?.level ?? 1);
  const [busy, setBusy] = useState(false);

  const cfg = BALANCE.upgrades[key];
  const cost = upgradeCostCents(key, level);
  const check = upgradeCheck(key, level, playerLevel, cash);
  const art = ICONS[key];

  const buy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await engine.buyUpgrade(crypto.randomUUID(), key);
      setUpgrades({ levels: result.levels });
      void playSound("coin");
      haptic("success");
      toast.success(t("bought"), t("boughtText", { name: ti(`${key}.name`), level: result.level }), { silent: true });
      await Promise.all([refreshPortfolio(), key === "study" || key === "overtime" ? refreshCareer() : null]);
    } catch (error) {
      toast.error(t("failed"), errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="lg" className="flex h-full flex-col gap-4" data-testid={`upgrade-${key}`} data-level={level}>
      <div className="flex items-start gap-4">
        <div
          className={cn(PIXEL_FRAME, "grid size-16 shrink-0 place-items-center border-line-2 bg-surface-2")}
          aria-hidden
        >
          <PixelIcon {...art} scale={iconScale(art)} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-fg-1">{ti(`${key}.name`)}</h2>
          <div className="mt-1.5 flex items-center gap-1" aria-label={t("levelOf", { level, max: cfg.maxLevel })}>
            {Array.from({ length: cfg.maxLevel }, (_, i) => (
              <motion.span
                key={i}
                initial={false}
                animate={i < level ? { scale: [1.5, 1], opacity: 1 } : { scale: 1, opacity: 1 }}
                transition={reduced ? { duration: 0 } : SPRING.bouncy}
                className={cn(
                  "size-3 rounded-[2px] border",
                  i < level ? "border-accent bg-accent" : "border-line-2 bg-surface-3",
                )}
              />
            ))}
            <span className="ml-1.5 nums text-xs text-fg-3" data-testid="upgrade-level">
              {t("levelOf", { level, max: cfg.maxLevel })}
            </span>
          </div>
          <p className="mt-2 text-sm text-pretty text-fg-2">{ti(`${key}.text`)}</p>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2" data-testid="upgrade-effect">
        <div className="rounded-md bg-surface-2 px-3 py-2">
          <p className="label-pixel text-fg-3">{t("now")}</p>
          <p className="nums text-sm font-semibold text-fg-1">{valueText(key, level)}</p>
        </div>
        <span aria-hidden className="text-fg-3">
          →
        </span>
        <div className={cn("rounded-md px-3 py-2", cost === null ? "bg-surface-2" : "bg-gain-soft")}>
          <p className="label-pixel text-fg-3">{t("next")}</p>
          <p className={cn("nums text-sm font-semibold", cost === null ? "text-fg-3" : "text-gain")}>
            {cost === null ? "—" : valueText(key, level + 1)}
          </p>
        </div>
      </div>

      <div className="mt-auto">
        {check === "maxed" ? (
          <p className="rounded-md bg-surface-2 px-3 py-2.5 text-center text-sm font-medium text-gain">{t("maxed")}</p>
        ) : check === "level" ? (
          <p className="rounded-md bg-surface-2 px-3 py-2.5 text-center text-sm text-fg-3">
            {t("fromLevel", { level: upgradeStageLevel(key, level) ?? cfg.minLevel })}
          </p>
        ) : (
          <>
            <HoldButton tone="accent" disabled={check !== "ok" || busy} onConfirm={() => void buy()} className="w-full">
              <span data-testid="upgrade-buy">{t("buy", { price: formatMoney(cost ?? 0, { whole: true }) })}</span>
            </HoldButton>
            {check === "cash" && (
              <p className="mt-1.5 text-center text-xs text-warn">
                {t("missing", { amount: formatMoney((cost ?? 0) - cash, { whole: true }) })}
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
