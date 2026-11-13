"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { TROPHIES } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { EmptyState } from "@/components/ui/empty-state";
import { PlayerTag } from "@/components/ui/player-tag";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import type { LeagueEntry, LeagueScope } from "@/features/game/types";
import { formatBps } from "@/lib/format";
import { SPRING, STAGGER } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useLeague } from "../hooks";

const METAL = ["gold", "silver", "bronze"] as const;
const PODIUM_HEIGHT = ["h-20", "h-14", "h-10"] as const;

/** The weekly league (ADR-089): podium, standings, scope and week switch, time left. */
export function LeagueBoard() {
  const t = useTranslations("social.league");
  const [scope, setScope] = useState<LeagueScope>("friends");
  const [week, setWeek] = useState<"current" | "last">("current");
  const league = useLeague(scope, week);
  const data = league.data;

  return (
    <div className="space-y-4" data-testid="league">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={scope}
          onValueChange={setScope}
          options={[
            { value: "friends", label: t("scopeFriends") },
            { value: "all", label: t("scopeAll") },
          ]}
          label={t("scope")}
          size="sm"
        />
        <Segmented
          value={week}
          onValueChange={setWeek}
          options={[
            { value: "current", label: t("weekCurrent") },
            { value: "last", label: t("weekLast") },
          ]}
          label={t("week")}
          size="sm"
        />
      </div>

      <Card padding="lg" className="space-y-1 rounded-xs border-2 [box-shadow:0_4px_0_0_var(--line-2)]">
        <p className="font-pixel text-sm text-fg-1 uppercase">{t("title")}</p>
        <p className="text-sm text-pretty text-fg-2">{t("rules")}</p>
        {data && week === "current" && (
          <p className="text-sm text-fg-3">
            {t("endsIn")} <Countdown target={Date.parse(data.season.endsAt)} className="font-semibold text-fg-1" />
          </p>
        )}
      </Card>

      {league.isPending ? (
        <Skeleton className="h-64 w-full rounded-xs" />
      ) : !data || data.entries.length === 0 ? (
        <EmptyState
          art={<PixelIcon {...TROPHIES.gold} scale={4} />}
          title={week === "last" ? t("emptyLastTitle") : t("emptyTitle")}
          description={t("emptyText")}
        />
      ) : (
        <>
          <Podium entries={data.entries.slice(0, 3)} />
          <ol className="space-y-1.5" data-testid="league-table">
            {data.entries.map((e, i) => (
              <motion.li
                key={e.nickname}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...SPRING.smooth, delay: i * STAGGER }}
              >
                <Row entry={e} />
              </motion.li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

/** Top three on a pixel podium: second, first, third. */
function Podium({ entries }: { entries: LeagueEntry[] }) {
  const order = [1, 0, 2].filter((i) => entries[i]);
  return (
    <div className="flex items-end justify-center gap-2 pt-2" aria-hidden>
      {order.map((i) => {
        const e = entries[i]!;
        return (
          <motion.div
            key={e.nickname}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING.bouncy, delay: 0.1 + (2 - i) * 0.08 }}
            className="flex w-24 flex-col items-center gap-1"
          >
            <PixelIcon {...TROPHIES[METAL[i]!]} scale={i === 0 ? 3 : 2} />
            <Avatar avatarKey={e.avatarKey} size="sm" />
            <span className="max-w-full truncate text-xs font-semibold text-fg-1">{e.nickname}</span>
            <span className={cn("nums text-xs", e.growthBps >= 0 ? "text-gain" : "text-loss")}>
              {formatBps(e.growthBps)}
            </span>
            <span
              className={cn(
                "grid w-full place-items-center rounded-xs border-2 border-line-2 bg-surface-2 font-pixel text-sm text-fg-1",
                PODIUM_HEIGHT[i],
                i === 0 && "border-gold bg-gold/15",
              )}
            >
              {i + 1}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

function Row({ entry }: { entry: LeagueEntry }) {
  return (
    <Link
      href={`/players/${encodeURIComponent(entry.nickname)}`}
      className={cn(
        "flex items-center gap-3 rounded-xs border-2 px-3 py-2 focus-ring transition duration-fast hover:bg-surface-2",
        entry.isMe ? "border-accent bg-accent-soft" : "border-line-1 bg-surface-1",
      )}
      data-me={entry.isMe}
    >
      <span className="w-6 text-center font-pixel text-sm text-fg-2">{entry.rank}</span>
      <Avatar avatarKey={entry.avatarKey} size="xs" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-1">{entry.nickname}</span>
      <PlayerTag tag={entry.tag} className="hidden sm:inline-flex" />
      <span className={cn("nums text-sm font-semibold", entry.growthBps >= 0 ? "text-gain" : "text-loss")}>
        {formatBps(entry.growthBps)}
      </span>
    </Link>
  );
}

/** Start page: my place in the friends league and the time left. */
export function LeaguePreview() {
  const t = useTranslations("social.league");
  const league = useLeague("friends");
  const data = league.data;
  const leader = data?.entries[0];
  return (
    <Link href="/friends?tab=league" className="block rounded-lg focus-ring" data-testid="league-preview">
      <Card padding="lg" interactive className="flex items-center gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-xs bg-surface-2">
          <PixelIcon {...TROPHIES.gold} scale={3} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block label-pixel text-fg-2">{t("title")}</span>
          {data?.me ? (
            <span className="block text-sm text-fg-1">
              {t("myPlace", { rank: data.me.rank, count: data.entries.length })} ·{" "}
              <span className={cn("nums", data.me.growthBps >= 0 ? "text-gain" : "text-loss")}>
                {formatBps(data.me.growthBps)}
              </span>
            </span>
          ) : (
            <span className="block text-sm text-fg-3">{t("previewEmpty")}</span>
          )}
          {leader && !leader.isMe && (
            <span className="block truncate text-xs text-fg-3">{t("leader", { name: leader.nickname })}</span>
          )}
        </span>
        {data && (
          <span className="text-right text-xs text-fg-3">
            {t("endsInShort")}
            <Countdown target={Date.parse(data.season.endsAt)} className="block text-sm text-fg-1" />
          </span>
        )}
      </Card>
    </Link>
  );
}
