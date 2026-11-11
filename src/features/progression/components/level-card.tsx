"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { BULL } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { BALANCE } from "@/config/balance";
import { useGame, usePlayerLevel } from "@/features/game/store";
import { formatInteger } from "@/lib/format";
import { EASE } from "@/lib/motion";
import { xpForNextLevel } from "@/lib/sim/progression";
import { romanTier, titleForLevel } from "@/config/titles";
import { NicknameSheet } from "@/features/settings/components/nickname-sheet";

/** Unlock keys have a translation each; see the test in src/features/progression. */
export type UnlockKey = Parameters<ReturnType<typeof useTranslations<"unlocks">>>[0];

/**
 * Level, XP bar and the next unlock. Every XP gain flies in as "+N XP".
 * `showcase` adds a button that plays the animation without changing anything.
 */
export function LevelCard({ showcase = false }: { showcase?: boolean }) {
  const t = useTranslations("profile");
  const tu = useTranslations("unlocks");
  const level = usePlayerLevel();
  const xp = useGame((state) => state.portfolio?.xpIntoLevel ?? 0);
  const xpTotal = useGame((state) => state.portfolio?.xpTotal);
  const tt = useTranslations("titles");
  const nickname = useGame((state) => state.portfolio?.nickname);
  const title = titleForLevel(level);
  const [renaming, setRenaming] = useState(false);
  const [gains, setGains] = useState<{ id: number; amount: number }[]>([]);
  const lastTotal = useRef<number | undefined>(undefined);
  const needed = xpForNextLevel(level);
  const shownXp = Math.min(xp, needed);
  const next = BALANCE.progression.unlocks.find((unlock) => unlock.level > level);

  const gain = (amount: number) => {
    const id = Date.now() + Math.random();
    setGains((list) => [...list, { id, amount }]);
    window.setTimeout(() => setGains((list) => list.filter((g) => g.id !== id)), 900);
  };

  // Show real XP gains as they arrive (not the initial load).
  useEffect(() => {
    if (xpTotal === undefined) return;
    const previous = lastTotal.current;
    lastTotal.current = xpTotal;
    if (previous !== undefined && xpTotal > previous) gain(xpTotal - previous);
  }, [xpTotal]);

  return (
    <Card padding="lg" data-tour="level-card">
      <NicknameSheet open={renaming} onOpenChange={setRenaming} />
      <div className="flex items-center gap-4">
        <div className="grid size-20 shrink-0 place-items-center rounded-lg bg-surface-2">
          <PixelIcon {...BULL} scale={4} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-xl font-semibold text-fg-1">{nickname ?? "…"}</p>
            {!showcase && (
              <button
                type="button"
                onClick={() => setRenaming(true)}
                aria-label={t("rename")}
                className="grid size-8 shrink-0 place-items-center rounded-sm text-fg-3 focus-ring transition-colors duration-fast hover:bg-surface-2 hover:text-fg-1"
              >
                <svg viewBox="0 0 7 7" width="14" height="14" shapeRendering="crispEdges" aria-hidden>
                  <path
                    fill="currentColor"
                    d="M5 0h1v1H5zM6 1h1v1H6zM4 1h1v1H4zM5 2h1v1H5zM3 2h1v1H3zM4 3h1v1H4zM2 3h1v1H2zM3 4h1v1H3zM1 4h1v1H1zM2 5h1v1H2zM0 5h1v2H0zM1 6h1v1H1z"
                  />
                </svg>
              </button>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone="accent">{t("level", { level })}</Badge>
            <span className="text-sm text-fg-3">
              {tt(title.key)} {romanTier(title.tier)}
            </span>
          </div>
        </div>
      </div>

      <div className="relative mt-5">
        <AnimatePresence>
          {gains.map((g) => (
            <motion.span
              key={g.id}
              className="pointer-events-none absolute -top-1 right-0 font-pixel text-sm font-bold text-accent"
              initial={{ opacity: 0, y: 28, scale: 0.8 }}
              animate={{ opacity: [0, 1, 1, 0], y: [28, 0, -4, -14], scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.85, ease: EASE.out }}
            >
              +{g.amount} XP
            </motion.span>
          ))}
        </AnimatePresence>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="label-pixel text-fg-2">XP</span>
          <span className="nums text-sm text-fg-2">
            {t("xp", { current: formatInteger(shownXp), total: formatInteger(needed) })}
          </span>
        </div>
        <Progress value={shownXp / needed} label={t("xpLabel")} />
      </div>

      {next && (
        <div className="mt-5 flex items-center justify-between gap-3 rounded-md bg-surface-2 px-4 py-3">
          <div className="min-w-0">
            <p className="label-pixel text-fg-3">{t("nextUnlock")}</p>
            <p className="mt-0.5 truncate font-medium text-fg-1">{tu(next.key as UnlockKey)}</p>
          </div>
          <Badge>{t("unlockAt", { level: next.level })}</Badge>
        </div>
      )}

      {showcase && (
        <button
          type="button"
          onClick={() => gain(40)}
          className="mt-4 h-9 w-full rounded-sm border border-line-2 label-pixel text-fg-2 focus-ring transition duration-fast hover:bg-surface-2 hover:text-fg-1 active:scale-[0.98]"
        >
          +40 XP
        </button>
      )}
    </Card>
  );
}
