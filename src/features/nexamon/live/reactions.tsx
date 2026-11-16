"use client";

import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BALANCE } from "@/config/balance";
import type { NexamonLiveReaction } from "@/features/game/pack-battle-types";
import { engine } from "@/features/game/store";
import { EASE } from "@/lib/motion";

/**
 * Emoji bursts over a live opening (ADR-172): every reaction of the last seconds floats up once; spectators get a
 * row of buttons.
 */
export function Reactions({
  liveId,
  reactions,
  canReact,
}: {
  liveId: string;
  reactions: readonly NexamonLiveReaction[];
  canReact: boolean;
}) {
  const t = useTranslations("nexamonLive");
  const reduced = useReducedMotionConfig();
  const [own, setOwn] = useState<NexamonLiveReaction[]>([]);
  // every reaction floats up once; finished ones stay hidden
  const [done, setDone] = useState<ReadonlySet<number>>(() => new Set());
  const byId = new Map<number, NexamonLiveReaction>();
  for (const r of [...reactions, ...own]) byId.set(r.id, r);
  const bursts = [...byId.values()].filter((r) => !done.has(r.id)).slice(-16);

  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-24 z-toast flex justify-center">
        <AnimatePresence>
          {bursts.map((r, i) => (
            <motion.span
              key={r.id}
              className="absolute text-2xl"
              style={{ left: `${30 + ((r.id * 37) % 40)}%` }}
              initial={{ opacity: 0, y: 0 }}
              animate={reduced ? { opacity: [0, 1, 0] } : { opacity: [0, 1, 1, 0], y: [-0, -120, -200, -260] }}
              transition={{ duration: 2.2, ease: EASE.out, delay: (i % 4) * 0.05 }}
              onAnimationComplete={() => setDone((d) => new Set([...d, r.id]))}
            >
              {r.emoji}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
      {canReact && (
        <div
          className="flex justify-center gap-1 border-t-2 border-line-1 bg-surface-1 px-4 py-2"
          role="group"
          aria-label={t("react")}
        >
          {BALANCE.nexamon.live.reactions.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="grid size-11 place-items-center rounded-md text-xl focus-ring transition duration-fast ease-standard hover:bg-surface-3 active:scale-90"
              data-testid="live-react"
              onClick={() => {
                void engine
                  .reactNexamonLive(crypto.randomUUID(), liveId, emoji)
                  .then(setOwn)
                  .catch(() => undefined);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
