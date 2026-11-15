"use client";

import { useTranslations } from "next-intl";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { BATTLE_ICONS } from "@/components/pixel/battle-art";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PlayerFigure } from "@/components/ui/player-figure";
import { BATTLE_ACCESSORIES, type BattleAccessoryItem } from "@/config/battle-accessories";
import { cn } from "@/lib/utils";

/**
 * The exclusive accessories of the news battles (ADR-160) in the wardrobe: never for sale, only the winner of a
 * battle gets one. Won ones can be put on and taken off like any other; the others show how to get them.
 */
export function BattleSkins({
  avatarKey,
  owned,
  worn,
  actions,
  onWear,
}: {
  avatarKey: string | null;
  owned: readonly string[];
  worn: readonly string[];
  actions: Record<string, ButtonState>;
  onWear: (item: BattleAccessoryItem, on: boolean) => void;
}) {
  const t = useTranslations("battle.skins");
  const won = BATTLE_ACCESSORIES.filter((a) => owned.includes(a.key)).length;
  return (
    <section className="space-y-3" data-testid="wardrobe-battle-skins">
      <div className="flex items-center gap-2">
        <PixelIcon {...BATTLE_ICONS.bell} scale={2} />
        <h2 className="min-w-0 flex-1 font-pixel text-sm text-fg-1">{t("title")}</h2>
        <span className="nums text-2xs text-fg-3">{t("won", { won, total: BATTLE_ACCESSORIES.length })}</span>
      </div>
      <p className="text-xs text-pretty text-fg-3">{t("hint")}</p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {BATTLE_ACCESSORIES.map((item) => {
          const has = owned.includes(item.key);
          const on = worn.includes(item.key);
          return (
            <li key={item.key}>
              <Card padding="none" className={cn("h-full overflow-hidden", !has && "opacity-70")}>
                <div className="relative grid place-items-center bg-gold/10 pt-3 pb-1">
                  <span className={cn(!has && "grayscale")}>
                    <PlayerFigure avatarKey={avatarKey} accessories={[item.key]} scale={3} />
                  </span>
                  {on && (
                    <Badge tone="gain" className="absolute top-2 right-2">
                      {t("worn")}
                    </Badge>
                  )}
                </div>
                <div className="space-y-1.5 p-2.5">
                  <p className="truncate text-sm font-semibold text-gold">{item.name}</p>
                  <p className="line-clamp-2 text-2xs text-pretty text-fg-3">{item.description}</p>
                  {has ? (
                    <Button
                      size="sm"
                      block
                      variant={on ? "secondary" : "primary"}
                      state={actions[item.key] ?? "idle"}
                      onClick={() => onWear(item, !on)}
                    >
                      {on ? t("takeOff") : t("wear")}
                    </Button>
                  ) : (
                    <p className="rounded-xs bg-surface-2 px-2 py-1 text-center text-2xs text-fg-2">{t("locked")}</p>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
