"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { Mascot } from "@/components/pixel/mascot";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button } from "@/components/ui/button";
import { burstConfetti } from "@/components/ui/effects";
import { useGame } from "@/features/game/store";
import { useTutorial } from "@/features/tutorial/store";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { unlocksAtLevel } from "@/lib/sim/progression";
import { nextUnlockTour } from "@/features/tutorial/tours";
import { playSound } from "@/lib/sound";
import type { UnlockKey } from "./level-card";

/**
 * Full-screen celebration when the level rises: Finn cheers, the new level
 * pops in and every unlock appears one after another. Not shown on the first
 * load and not during the tutorial (it has its own finale).
 */
export function LevelUpOverlay() {
  const t = useTranslations("levelUp");
  const tu = useTranslations("unlocks");
  const [shownLevel, setShownLevel] = useState<number | null>(null);
  const anchor = useRef<HTMLDivElement>(null);

  // Celebrate only real level changes, never the first load, never inside the tutorial.
  useEffect(
    () =>
      useGame.subscribe((state, previous) => {
        const now = state.portfolio?.level;
        const before = previous.portfolio?.level;
        if (now && before && now > before && useTutorial.getState().status !== "active") setShownLevel(now);
      }),
    [],
  );

  useEffect(() => {
    if (shownLevel === null) return;
    void playSound("levelUp");
    haptic("success");
    const timer = window.setTimeout(() => anchor.current && burstConfetti(anchor.current, 36), 250);
    return () => window.clearTimeout(timer);
  }, [shownLevel]);

  const unlocks = shownLevel ? unlocksAtLevel(shownLevel) : [];

  // Closing the overlay starts Finn's short tour for a newly unlocked feature (ADR-046).
  const close = () => {
    const level = shownLevel;
    setShownLevel(null);
    if (level === null) return;
    const { seenTours, startTour } = useTutorial.getState();
    const pending = nextUnlockTour(level, seenTours);
    if (pending) window.setTimeout(() => startTour(pending), 350);
  };

  return (
    <AnimatePresence>
      {shownLevel !== null && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={t("title", { level: shownLevel })}
          className="fixed inset-0 z-celebration grid place-items-center bg-scrim px-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION.base }}
          onClick={close}
        >
          <motion.div
            className="w-full max-w-sm rounded-xl border border-line-2 bg-surface-1 p-6 text-center shadow-3"
            initial={{ scale: 0.8, y: 24 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={SPRING.bouncy}
            onClick={(event) => event.stopPropagation()}
          >
            <div ref={anchor} className="mx-auto w-fit">
              <Mascot mood="happy" scale={6} />
            </div>
            <p className="mt-4 label-pixel text-accent">{t("kicker")}</p>
            <motion.p
              className="mt-1 font-pixel text-4xl text-fg-1 uppercase"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ ...SPRING.bouncy, delay: 0.15 }}
            >
              {t("title", { level: shownLevel })}
            </motion.p>
            {unlocks.length > 0 && (
              <ul className="mt-5 space-y-2 text-left">
                {unlocks.map((unlock, index) => (
                  <motion.li
                    key={unlock.key}
                    className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2.5"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: DURATION.slow, ease: EASE.out, delay: 0.45 + index * 0.18 }}
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-xs bg-gain-soft text-gain">
                      <PixelIcon {...UI_ICONS.lock} scale={1} />
                    </span>
                    <span className="text-fg-1">{tu(unlock.key as UnlockKey)}</span>
                  </motion.li>
                ))}
              </ul>
            )}
            <Button block size="lg" className="mt-6" onClick={close}>
              {t("continue")}
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
