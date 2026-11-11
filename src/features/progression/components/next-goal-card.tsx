"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { LockBadge } from "@/components/ui/lock-badge";
import { Progress } from "@/components/ui/progress";
import { BALANCE } from "@/config/balance";
import { useGame, usePlayerLevel } from "@/features/game/store";
import { formatInteger } from "@/lib/format";
import { xpForNextLevel } from "@/lib/sim/progression";
import type { UnlockKey } from "./level-card";

/** Highlights on the way up, shown as locked previews on the start page. */
const HIGHLIGHTS = ["limit_orders", "bonds", "short_selling", "found_small_business", "leverage_2x", "ipo"] as const;

/**
 * One clear goal on the start page (the next unlock and how far away it is),
 * plus a glimpse of the big features still to come, shown locked.
 */
export function NextGoalCard() {
  const t = useTranslations("home");
  const tp = useTranslations("profile");
  const tu = useTranslations("unlocks");
  const level = usePlayerLevel();
  const xp = useGame((state) => state.portfolio?.xpIntoLevel ?? 0);
  const needed = xpForNextLevel(level);
  const unlocks = BALANCE.progression.unlocks;
  const next = unlocks.find((unlock) => unlock.level > level);
  const upcoming = HIGHLIGHTS.map((key) => unlocks.find((u) => u.key === key))
    .filter((u): u is (typeof unlocks)[number] => !!u && u.level > level && u.key !== next?.key)
    .slice(0, 3);
  if (!next) return null;

  return (
    <Card padding="lg">
      <Link
        href="/profile"
        className="-m-2 block rounded-md p-2 focus-ring transition-colors duration-fast hover:bg-surface-2"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="label-pixel text-fg-2">{t("nextGoal")}</h2>
          <Badge tone="accent">{tp("unlockAt", { level: next.level })}</Badge>
        </div>
        <p className="mt-2 font-medium text-fg-1">{tu(next.key as UnlockKey)}</p>
        <Progress value={xp / needed} label={tp("xpLabel")} size="sm" className="mt-3" />
        <p className="mt-2 nums text-sm text-fg-3">
          {tp("level", { level })} · {tp("xp", { current: formatInteger(xp), total: formatInteger(needed) })}
        </p>
      </Link>
      {upcoming.length > 0 && (
        <div className="mt-4 border-t border-line-1 pt-4">
          <p className="label-pixel text-fg-3">{t("comingUp")}</p>
          <ul className="mt-2 space-y-2">
            {upcoming.map((unlock) => (
              <li key={unlock.key} className="flex items-center gap-3 text-fg-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-xs bg-surface-2 text-fg-3">
                  <PixelIcon {...UI_ICONS.lock} scale={1} />
                </span>
                <span className="min-w-0 flex-1 truncate">{tu(unlock.key as UnlockKey)}</span>
                <LockBadge level={unlock.level} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
