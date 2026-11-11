"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { SkeletonRow } from "@/components/ui/skeleton";
import { useGame } from "@/features/game/store";
import type { RichListScope } from "@/features/game/types";
import { SPRING } from "@/lib/motion";
import { useRichList } from "../hooks";
import { MyRankCard } from "./my-rank-card";
import { RankRow } from "./rank-row";
import { RichNews } from "./rich-news";

/** The full rich list: everyone, or players only, refreshed every few seconds. */
export function RichListBoard() {
  const t = useTranslations("richList");
  const [scope, setScope] = useState<RichListScope>("all");
  const list = useRichList(scope, 100);
  const track = useGame((state) => state.track);

  useEffect(() => track("open_rich_list"), [track]);

  const me = list.data?.me;
  const meVisible = list.data?.entries.some((e) => e.isMe);
  const meEntry =
    list.data && !meVisible && me
      ? {
          rank: me.rank,
          kind: "player" as const,
          id: "me",
          name: t("youName"),
          description: null,
          netWorthCents: me.netWorthCents,
          change24hBps: null,
          rankChange24h: null,
          isMe: true,
        }
      : null;

  return (
    <div className="grid gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
      <Card padding="lg">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <Segmented
            value={scope}
            onValueChange={setScope}
            label={t("scope")}
            size="sm"
            options={[
              { value: "all", label: t("scopeAll") },
              { value: "players", label: t("scopePlayers") },
            ]}
          />
          <span className="text-xs text-fg-3">{t("live")}</span>
        </div>
        {!list.data && Array.from({ length: 8 }, (_, i) => <SkeletonRow key={i} />)}
        <ol className="space-y-1">
          <AnimatePresence initial={false}>
            {list.data?.entries.map((entry) => (
              <motion.li key={`${entry.kind}-${entry.id}`} layout transition={SPRING.smooth}>
                <RankRow entry={entry} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
        {meEntry && (
          <div className="mt-3 border-t border-line-1 pt-3">
            <RankRow entry={meEntry} />
          </div>
        )}
      </Card>
      <div className="space-y-5 lg:space-y-6">
        <MyRankCard />
        <RichNews limit={10} />
        <p className="text-sm text-pretty text-fg-3">{t("explain")}</p>
      </div>
    </div>
  );
}
