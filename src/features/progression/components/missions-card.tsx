"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonRow } from "@/components/ui/skeleton";
import { useGame } from "@/features/game/store";
import type { Mission } from "@/features/game/types";
import { MissionItem } from "./mission-item";

/** Done first, then the closest to completion. */
function nextUp(missions: Mission[]): Mission[] {
  const rank = (m: Mission) => (m.status === "completed" ? 0 : m.status === "active" ? 1 : 2);
  return [...missions].sort((a, b) => rank(a) - rank(b) || b.progress / b.target - a.progress / a.target);
}

/**
 * Start page: the next three missions, quick and daily ones first. There is
 * always something small to do, from the very first minute.
 */
export function MissionsCard() {
  const t = useTranslations("missions");
  const groups = useGame((state) => state.missions);
  const claimable = groups?.flatMap((g) => g.missions).filter((m) => m.status === "completed").length ?? 0;
  const shown = groups
    ? nextUp(groups.filter((g) => g.kind === "quick" || g.kind === "daily").flatMap((g) => g.missions)).slice(0, 3)
    : null;

  return (
    <Card padding="lg" data-tour="missions">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        {claimable > 0 && <Badge tone="accent">{t("claimable", { count: claimable })}</Badge>}
      </CardHeader>
      <div className="space-y-2">
        {shown === null && (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        )}
        {shown?.map((mission) => (
          <MissionItem key={mission.id} mission={mission} compact />
        ))}
      </div>
      <Link
        href="/missions"
        transitionTypes={["nav-forward"]}
        className="mt-3 flex h-10 items-center justify-center rounded-sm label-pixel text-accent focus-ring transition-colors duration-fast hover:bg-surface-2"
      >
        {t("all")}
      </Link>
    </Card>
  );
}
