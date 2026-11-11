"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { SkeletonRow } from "@/components/ui/skeleton";
import { useGame } from "@/features/game/store";
import type { MissionKind } from "@/features/game/types";
import { fadeUp, staggerContainer } from "@/lib/motion";
import { MissionItem } from "./mission-item";

const ORDER: readonly MissionKind[] = ["quick", "daily", "weekly", "milestone"];

/** All mission groups: quick (refill), daily, weekly and the long story path. */
export function MissionsBoard() {
  const t = useTranslations("missions");
  const groups = useGame((state) => state.missions);
  const streak = useGame((state) => state.portfolio?.streakDays ?? 0);
  const refresh = useGame((state) => state.refreshMissions);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!groups) {
    return (
      <Card padding="lg">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </Card>
    );
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="grid gap-5 *:min-w-0 lg:grid-cols-2 lg:gap-6"
    >
      {ORDER.map((kind) => {
        const group = groups.find((g) => g.kind === kind);
        if (!group) return null;
        return (
          <motion.div key={kind} variants={fadeUp}>
            <Card padding="lg" className="h-full">
              <CardHeader>
                <div>
                  <CardTitle>{t(`kind.${kind}`)}</CardTitle>
                  <p className="mt-1 text-sm text-fg-3">{t(`hint.${kind}`)}</p>
                </div>
                {group.resetsAt && (
                  <span className="shrink-0 text-right text-xs text-fg-3">
                    {t("resetsIn")}
                    <br />
                    <Countdown target={Date.parse(group.resetsAt)} className="text-fg-2" />
                  </span>
                )}
              </CardHeader>
              <div className="space-y-2">
                {group.missions.length === 0 && <p className="text-sm text-fg-3">{t("empty")}</p>}
                {group.missions.map((mission) => (
                  <MissionItem key={mission.id} mission={mission} />
                ))}
              </div>
              {kind === "daily" && streak > 0 && (
                <p className="mt-3 text-sm text-fg-3">{t("streak", { days: streak })}</p>
              )}
            </Card>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
