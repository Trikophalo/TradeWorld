"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { PlayerFigure } from "@/components/ui/player-figure";
import { PlazaGround } from "@/components/ui/plaza-ground";
import { Skeleton } from "@/components/ui/skeleton";
import { accessoryByKey } from "@/config/accessories";
import { useGame } from "@/features/game/store";
import { cn } from "@/lib/utils";
import { useWardrobe } from "../hooks";
import { RARITY_STYLE } from "./rarity";

/**
 * A player's dressed pixel figure with what they wear (ADR-154): on every profile; the own one links to the
 * wardrobe, a friend's one carries the poke button (`action`).
 */
export function FigureCard({
  nickname,
  avatarKey,
  accessories,
  own,
  action,
}: {
  nickname: string;
  avatarKey: string | null;
  accessories: readonly string[];
  own: boolean;
  action?: ReactNode;
}) {
  const t = useTranslations("wardrobe");
  const items = accessories.map((key) => accessoryByKey(key)).filter((item) => item !== undefined);
  return (
    <Card padding="none" className="overflow-hidden" data-testid="figure-card">
      <div className="flex items-stretch">
        <div className="relative isolate grid w-32 shrink-0 place-items-center bg-spotlight px-2 pt-4 lg:w-40">
          <span aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-10">
            <PlazaGround />
          </span>
          <span className="block pb-2">
            <PlayerFigure
              avatarKey={avatarKey}
              accessories={accessories}
              scale={4}
              className="lg:h-40 lg:w-30"
              title={own ? t("figure") : t("figureOf", { name: nickname })}
            />
          </span>
        </div>
        <div className="min-w-0 flex-1 space-y-3 border-l-2 border-line-1 p-4">
          <p className="label-pixel text-fg-3">{own ? t("figure") : t("figureOf", { name: nickname })}</p>
          {items.length === 0 ? (
            <p className="text-sm text-fg-3">{t("wearingNothing")}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5" data-testid="figure-worn">
              {items.map((item) => (
                <li
                  key={item.key}
                  className={cn("rounded-xs px-1.5 py-0.5 text-xs", RARITY_STYLE[item.rarity].soft)}
                  title={item.description}
                >
                  <span className={RARITY_STYLE[item.rarity].text}>{item.name}</span>
                </li>
              ))}
            </ul>
          )}
          {own ? (
            <Link
              href="/profile/wardrobe"
              className={buttonVariants({ variant: "secondary", size: "sm" })}
              data-testid="open-wardrobe"
            >
              {t("open")}
            </Link>
          ) : (
            action
          )}
        </div>
      </div>
    </Card>
  );
}

/** The own figure on the profile page, from the wardrobe (ADR-154). */
export function MyFigureCard() {
  const wardrobe = useWardrobe();
  const nickname = useGame((state) => state.portfolio?.nickname ?? "");
  const avatarKey = useGame((state) => state.portfolio?.avatarKey ?? null);
  if (!wardrobe.data) return <Skeleton className="h-44 w-full rounded-lg" />;
  return <FigureCard nickname={nickname} avatarKey={avatarKey} accessories={wardrobe.data.worn} own />;
}
