"use client";

import { useTranslations } from "next-intl";
import { COIN, UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Card } from "@/components/ui/card";
import { BALANCE } from "@/config/balance";
import type { LivingBonusState } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { ownerLivingBonus } from "@/lib/sim/living";
import { nextTier } from "@/lib/sim/property";

/** XP as the player sees it: the base XP times the alpha factor (upgrades may add a little on top). */
export const shownXp = (baseXp: number) => Math.round(baseXp * BALANCE.progression.xpMultiplier);

/**
 * The living bonus (ADR-161): what living in the home brings every hour, and what raises it: a higher Wohnwert,
 * a bigger home, an own home instead of a rented place.
 */
export function LivingBonusCard({ bonus }: { bonus: LivingBonusState | null }) {
  const t = useTranslations("living");
  const te = useTranslations("estate");
  const cfg = BALANCE.livingBonus;
  const share = Math.round(cfg.tenantShareBps / 100);

  if (!bonus) {
    return (
      <Card padding="md" className="flex items-start gap-3" data-testid="living-bonus" data-source="none">
        <PixelIcon {...UI_ICONS.home} scale={2} />
        <div className="min-w-0 space-y-1">
          <p className="label-pixel text-fg-2">{t("title")}</p>
          <p className="text-sm text-pretty text-fg-2">{t("none")}</p>
        </div>
      </Card>
    );
  }

  const tips: string[] = [];
  if (bonus.source === "tenant") tips.push(t("raiseOwn", { share }));
  if (bonus.source === "own" && bonus.wohnwert < 100) {
    const full = ownerLivingBonus(bonus.tier, 100);
    tips.push(t("raiseWohnwert", { amount: formatMoney(full.cents), xp: shownXp(full.xp) }));
  }
  const up = nextTier(bonus.tier);
  if (up) {
    const bigger = ownerLivingBonus(up, 100);
    tips.push(
      t("raiseTier", { tier: te(`tierNames.${up}`), amount: formatMoney(bigger.cents), xp: shownXp(bigger.xp) }),
    );
  }
  if (tips.length === 0) tips.push(t("max"));

  return (
    <Card padding="md" className="space-y-3" data-testid="living-bonus" data-source={bonus.source}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-gain-soft">
          <PixelIcon {...COIN} scale={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="label-pixel text-fg-2">{t("title")}</p>
          <p className="nums text-lg font-semibold text-gain" data-testid="living-bonus-amount">
            {t("perHour", { amount: formatMoney(bonus.cents), xp: shownXp(bonus.xp) })}
          </p>
        </div>
      </div>
      <p className="text-sm text-pretty text-fg-2">
        {bonus.source === "own"
          ? t("own", { tier: te(`tierNames.${bonus.tier}`), wohnwert: bonus.wohnwert })
          : t("tenant", {
              owner: bonus.owner ?? "",
              tier: te(`tierNames.${bonus.tier}`),
              wohnwert: bonus.wohnwert,
              share,
            })}
      </p>
      <div className="space-y-1.5 rounded-md bg-surface-2 p-3">
        <p className="label-pixel text-fg-3">{t("raiseTitle")}</p>
        <ul className="space-y-1 text-sm text-pretty text-fg-2" data-testid="living-bonus-tips">
          {tips.map((tip) => (
            <li key={tip} className="flex gap-2">
              <span aria-hidden className="text-accent">
                ▸
              </span>
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-pretty text-fg-3">{t("paid", { days: cfg.activeDays })}</p>
    </Card>
  );
}
