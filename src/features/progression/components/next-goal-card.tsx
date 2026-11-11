"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { BALANCE } from "@/config/balance";
import { useDemo } from "@/lib/demo/store";
import { formatInteger } from "@/lib/format";
import { xpForNextLevel } from "@/lib/sim/progression";
import type { UnlockKey } from "./level-card";

/** One clear goal on the start page: the next thing the player unlocks and how far away it is. */
export function NextGoalCard() {
  const t = useTranslations("home");
  const tp = useTranslations("profile");
  const tu = useTranslations("unlocks");
  const level = useDemo((state) => state.level);
  const xp = useDemo((state) => state.xpInLevel);
  const needed = xpForNextLevel(level);
  const next = BALANCE.progression.unlocks.find((unlock) => unlock.level > level);
  if (!next) return null;

  return (
    <Link href="/profile" className="block rounded-lg focus-ring">
      <Card padding="lg" interactive>
        <div className="flex items-center justify-between gap-3">
          <h2 className="label-pixel text-fg-2">{t("nextGoal")}</h2>
          <Badge tone="accent">{tp("unlockAt", { level: next.level })}</Badge>
        </div>
        <p className="mt-2 font-medium text-fg-1">{tu(next.key as UnlockKey)}</p>
        <Progress value={xp / needed} label={tp("xpLabel")} size="sm" className="mt-3" />
        <p className="mt-2 nums text-sm text-fg-3">
          {tp("level", { level })} · {tp("xp", { current: formatInteger(xp), total: formatInteger(needed) })}
        </p>
      </Card>
    </Link>
  );
}
