"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { PlayerTag } from "@/components/ui/player-tag";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlayerCard } from "@/features/career/hooks";
import { useGame } from "@/features/game/store";

/** The own name and tag on the profile, with copy, so friends can find you (ADR-085). */
export function MyTagCard() {
  const t = useTranslations("playerTag");
  const nickname = useGame((state) => state.portfolio?.nickname ?? "");
  const card = usePlayerCard(nickname);
  return (
    <Card padding="lg" className="flex flex-wrap items-center gap-3" data-testid="my-tag">
      <div className="min-w-0 flex-1">
        <p className="label-pixel text-fg-2">{t("mine")}</p>
        <p className="mt-1 text-sm text-pretty text-fg-3">{t("mineHint")}</p>
      </div>
      {card.data ? (
        <span className="flex items-center gap-2">
          <span className="font-semibold text-fg-1">{card.data.nickname}</span>
          <PlayerTag tag={card.data.tag} copy className="text-xs" />
        </span>
      ) : (
        <Skeleton className="h-6 w-32 rounded-sm" />
      )}
    </Card>
  );
}
