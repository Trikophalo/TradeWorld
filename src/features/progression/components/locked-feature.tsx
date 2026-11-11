"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Card } from "@/components/ui/card";
import { LockBadge } from "@/components/ui/lock-badge";
import { Progress } from "@/components/ui/progress";
import { useGame, usePlayerLevel } from "@/features/game/store";
import { formatInteger } from "@/lib/format";
import { totalXpForLevel } from "@/lib/sim/progression";
import { cn } from "@/lib/utils";

export interface LockedFeatureProps {
  level: number;
  title: string;
  description: string;
  art?: ReactNode;
  className?: string;
}

/**
 * Teaser for a feature that unlocks later: what it is, from which level, and
 * how far away that is. Everything the game will offer is visible from the
 * start, only locked (docs/DECISIONS.md, ADR-035).
 */
export function LockedFeature({ level, title, description, art, className }: LockedFeatureProps) {
  const t = useTranslations("locks");
  const current = usePlayerLevel();
  const xpTotal = useGame((state) => state.portfolio?.xpTotal ?? 0);
  const start = totalXpForLevel(current);
  const target = totalXpForLevel(level);
  const progress = target > start ? (xpTotal - start) / (target - start) : 1;

  return (
    <Card padding="lg" className={cn("relative overflow-hidden", className)}>
      <div className="flex items-start gap-4">
        <div className="relative grid size-14 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-3">
          <span className="opacity-40 grayscale">{art ?? <PixelIcon {...UI_ICONS.lock} scale={3} />}</span>
          {art && (
            <span className="absolute -right-1 -bottom-1 grid size-6 place-items-center rounded-xs bg-surface-3 text-fg-2">
              <PixelIcon {...UI_ICONS.lock} scale={1} />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-fg-1">{title}</h3>
            <LockBadge level={level} />
          </div>
          <p className="mt-1 text-sm text-pretty text-fg-2">{description}</p>
        </div>
      </div>
      <Progress value={Math.max(0, Math.min(1, progress))} label={t("progress")} size="sm" className="mt-4" />
      <p className="mt-2 nums text-xs text-fg-3">
        {t("levelsToGo", { count: Math.max(0, level - current), xp: formatInteger(Math.max(0, target - xpTotal)) })}
      </p>
    </Card>
  );
}
