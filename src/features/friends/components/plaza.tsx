"use client";

import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { PLAZA_BENCH, PLAZA_BUSH, PLAZA_FOUNTAIN, PLAZA_LAMP, PLAZA_TREE } from "@/components/pixel/plaza";
import { Card } from "@/components/ui/card";
import { PlayerFigure } from "@/components/ui/player-figure";
import { PlazaGround } from "@/components/ui/plaza-ground";
import { Skeleton } from "@/components/ui/skeleton";
import type { FriendEntry } from "@/features/game/types";
import { DURATION, EASE } from "@/lib/motion";
import { useMountTime } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { useFriends } from "../hooks";
import { usePoke } from "./poke";

/** A small, stable offset per name, so the crowd does not stand in a perfect grid. */
function jitter(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 3;
}

/**
 * The friends plaza (ADR-154): every friend stands on a little town square as their dressed pixel figure, online
 * ones with a green sign above the head and a small hop. A figure opens the profile; 👉 pokes. Many friends wrap
 * into rows and scroll inside the plaza, never sideways.
 */
export function FriendsPlaza() {
  const t = useTranslations("friends.plaza");
  const friends = useFriends();
  // The list may already be cached (sidebar badge); wait for the mount so the markup matches the server's.
  const mounted = useMountTime() !== null;
  if (!mounted || !friends.data) return <Skeleton className="h-64 w-full rounded-lg" />;
  const list = friends.data.friends;
  const online = list.filter((f) => f.online).length;

  return (
    <Card padding="none" className="overflow-hidden" data-testid="friends-plaza">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-4 pb-3 lg:px-5">
        <h2 className="font-pixel text-sm text-fg-1 uppercase">{t("title")}</h2>
        {list.length > 0 && (
          <p className="nums text-xs text-fg-3" data-testid="plaza-summary">
            {t("summary", { count: list.length, online })}
          </p>
        )}
      </div>
      <div className="relative isolate border-t-2 border-line-1">
        <PlazaGround className="-z-10" />
        <Decor />
        {list.length === 0 ? (
          <div className="relative px-4 pt-2 pb-6 text-center">
            <p className="font-semibold text-fg-1">{t("emptyTitle")}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-pretty text-fg-2">{t("emptyText")}</p>
          </div>
        ) : (
          <>
            <ul
              aria-label={t("label", { count: list.length })}
              className="grid max-h-[min(70vh,560px)] grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-x-2 gap-y-3 overflow-y-auto overscroll-contain px-3 pt-2 pb-4 lg:grid-cols-[repeat(auto-fill,minmax(124px,1fr))] lg:px-5"
            >
              {list.map((friend, i) => (
                <FriendFigure key={friend.nickname} friend={friend} index={i} />
              ))}
            </ul>
            <p className="relative border-t-2 border-line-1 bg-surface-1 px-4 py-2 text-xs text-pretty text-fg-3 lg:px-5">
              {t("hint")}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

/** Trees, lamps, benches and the fountain along the top edge of the square. */
function Decor() {
  return (
    <div aria-hidden className="pointer-events-none flex items-end justify-between gap-2 px-3 pt-3 pb-1 lg:px-6">
      <PixelIcon {...PLAZA_TREE} scale={3} className="lg:h-[72px] lg:w-16" />
      <PixelIcon {...PLAZA_LAMP} scale={3} className="hidden sm:block lg:h-[72px] lg:w-8" />
      <PixelIcon {...PLAZA_BENCH} scale={3} className="hidden lg:block lg:h-10 lg:w-[72px]" />
      <PixelIcon {...PLAZA_BUSH} scale={3} className="hidden sm:block lg:h-8 lg:w-12" />
      <PixelIcon {...PLAZA_FOUNTAIN} scale={3} className="lg:h-[76px] lg:w-28" />
      <PixelIcon {...PLAZA_BUSH} scale={3} className="hidden sm:block lg:h-8 lg:w-12" />
      <PixelIcon {...PLAZA_BENCH} scale={3} className="hidden lg:block lg:h-10 lg:w-[72px]" />
      <PixelIcon {...PLAZA_LAMP} scale={3} className="hidden sm:block lg:h-[72px] lg:w-8" />
      <PixelIcon {...PLAZA_TREE} scale={3} className="lg:h-[72px] lg:w-16" />
    </div>
  );
}

function FriendFigure({ friend, index }: { friend: FriendEntry; index: number }) {
  const t = useTranslations("friends");
  const reduced = useReducedMotionConfig();
  const { poke, state, pokes } = usePoke(friend.nickname);
  const offset = jitter(friend.nickname);

  return (
    <motion.li
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.slow, ease: EASE.out, delay: Math.min(index, 12) * 0.03 }}
      className="relative flex min-w-0 flex-col items-center"
      style={{ marginTop: offset * 4 }}
      data-testid="plaza-friend"
      data-nickname={friend.nickname}
      data-online={friend.online ? "true" : "false"}
    >
      <span className={cn("mb-0.5 h-4", !friend.online && "invisible")}>
        <span
          className="rounded-xs bg-gain px-1 py-px label-pixel text-2xs text-on-semantic"
          data-testid="plaza-online"
        >
          {t("online")}
        </span>
      </span>
      <Link
        href={`/players/${encodeURIComponent(friend.nickname)}`}
        aria-label={t("openProfile", { name: friend.nickname })}
        className="group relative grid place-items-center rounded-sm focus-ring"
      >
        <motion.span
          key={pokes}
          className="relative z-10 block origin-bottom transition-transform duration-fast ease-standard group-hover:-translate-y-1 group-active:translate-y-0"
          animate={reduced || pokes === 0 ? undefined : { rotate: [0, -12, 9, -5, 0], x: [0, 5, -2, 1, 0] }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          <motion.span
            className="block"
            animate={friend.online && !reduced ? { y: [0, -3, 0] } : undefined}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut", delay: (index % 5) * 0.25 }}
          >
            <PlayerFigure
              avatarKey={friend.avatarKey}
              accessories={friend.accessories}
              scale={3}
              className="lg:h-32 lg:w-24"
            />
          </motion.span>
        </motion.span>
        <span aria-hidden className="absolute inset-x-2 bottom-0 h-1.5 rounded-pill bg-shade opacity-60" />
        <AnimatePresence>
          {pokes > 0 && !reduced && (
            <motion.span
              key={pokes}
              aria-hidden
              className="pointer-events-none absolute top-1/3 -left-3 z-20 text-lg"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: [0, 1, 1, 0], x: [-10, 4, 0, 6] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
            >
              👉
            </motion.span>
          )}
        </AnimatePresence>
      </Link>
      <span className="mt-1 flex w-full min-w-0 items-center justify-center gap-0.5">
        <span className="truncate text-xs font-medium text-fg-1">{friend.nickname}</span>
        <button
          type="button"
          onClick={() => void poke()}
          disabled={state !== "idle"}
          aria-label={t("pokeLabel", { name: friend.nickname })}
          title={t("poke")}
          className="grid size-7 shrink-0 place-items-center rounded-xs text-sm focus-ring transition duration-fast ease-standard hover:bg-surface-3 active:scale-90 disabled:opacity-50"
          data-testid="plaza-poke"
        >
          <span aria-hidden className={cn(state === "loading" && "animate-pulse")}>
            {state === "success" ? "✓" : "👉"}
          </span>
        </button>
      </span>
    </motion.li>
  );
}
