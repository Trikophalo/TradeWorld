"use client";

import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { PixelCheck } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { BALANCE } from "@/config/balance";
import { UNLOCK_PREVIEW_LEVELS } from "@/config/disclosure";
import { useDemo } from "@/lib/demo/store";
import { cn } from "@/lib/utils";
import type { UnlockKey } from "./level-card";

/** Every unlock from level 1 to 50, grouped by level. */
export function UnlockList() {
  const t = useTranslations("profile");
  const tu = useTranslations("unlocks");
  const level = useDemo((state) => state.level);

  const groups = new Map<number, string[]>();
  for (const unlock of BALANCE.progression.unlocks) {
    groups.set(unlock.level, [...(groups.get(unlock.level) ?? []), unlock.key]);
  }

  // Reached levels plus a short preview. The rest is discovered by playing.
  const all = [...groups];
  const upcoming = all.filter(([unlockLevel]) => unlockLevel > level);
  const shown = [...all.filter(([unlockLevel]) => unlockLevel <= level), ...upcoming.slice(0, UNLOCK_PREVIEW_LEVELS)];
  const hasMore = upcoming.length > UNLOCK_PREVIEW_LEVELS;

  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle>{t("unlocks")}</CardTitle>
      </CardHeader>
      <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-0.5 before:bg-line-1">
        {shown.map(([unlockLevel, keys]) => {
          const reached = level >= unlockLevel;
          return (
            <li key={unlockLevel} className="relative flex gap-4">
              <span
                className={cn(
                  "relative grid size-8 shrink-0 place-items-center rounded-xs",
                  reached ? "bg-gain text-on-semantic" : "bg-surface-3 text-fg-3",
                )}
              >
                {reached ? <PixelCheck className="scale-75" /> : <PixelIcon {...UI_ICONS.lock} scale={1} />}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="label-pixel text-fg-3">{t("unlockAt", { level: unlockLevel })}</p>
                {keys.map((key) => (
                  <p key={key} className={cn("mt-0.5", reached ? "text-fg-1" : "text-fg-2")}>
                    {tu(key as UnlockKey)}
                  </p>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      {hasMore && <p className="mt-4 pl-12 text-sm text-fg-3">{t("unlocksMore")}</p>}
    </Card>
  );
}
