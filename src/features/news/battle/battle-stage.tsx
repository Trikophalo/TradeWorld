"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { isTickKind } from "@/config/battles";
import type { Battle, BattleState } from "@/features/game/battle-types";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ArenaGame } from "./arena-game";
import { IntroCard, Podium } from "./intro-podium";
import { GameIcon } from "./parts";
import { PumpGame } from "./pump-game";
import { BellGame, EstimateGame, QuizGame } from "./round-games";

/*
 * The battle on the whole screen (ADR-160): intro, the game, then the podium. Players are taken here when their
 * battle starts; everyone else can watch. The page behind does not scroll while it is open.
 */
export function BattleStage({
  battle,
  offsetMs,
  onState,
  onFinished,
  onClose,
}: {
  battle: Battle;
  offsetMs: number;
  onState: (state: BattleState) => void;
  onFinished: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("battle");
  const [now, setNow] = useState<number | null>(null);
  const kind = battle.kind;
  useEffect(() => {
    const tick = () => setNow(Date.now() + offsetMs);
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [offsetMs]);
  useEffect(() => {
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", esc);
    return () => {
      html.style.overflow = before;
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const finished = useCallback(() => onFinished(), [onFinished]);

  if (typeof document === "undefined" || !kind) return null;
  const msToStart = battle.startedAt && now !== null ? Date.parse(battle.startedAt) - now : 0;
  const over = battle.status === "finished";
  const props = { battle, offsetMs, onFinished: finished };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.base, ease: EASE.out }}
      className="fixed inset-0 z-sheet flex flex-col bg-bg"
      role="dialog"
      aria-modal="true"
      aria-label={t(`games.${kind}.name`)}
      data-testid="battle-stage"
      data-status={battle.status}
    >
      <header className="flex items-center gap-3 border-b-2 border-line-1 bg-surface-1 px-4 py-2">
        <GameIcon kind={kind} scale={2} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-pixel text-sm text-fg-1">{t(`games.${kind}.name`)}</p>
          <p className="truncate text-2xs text-fg-3">{t("intro.battle", { id: battle.id })}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid size-10 place-items-center rounded-md text-fg-2 focus-ring transition duration-fast hover:bg-surface-2 hover:text-fg-1 active:scale-95"
          aria-label={battle.joined && !over ? t("minimize") : t("close")}
          data-testid="battle-stage-close"
        >
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden shapeRendering="crispEdges">
            <path
              fill="currentColor"
              d="M2 2h2v2H2zM4 4h2v2H4zM6 6h4v4H6zM10 4h2v2h-2zM12 2h2v2h-2zM4 10h2v2H4zM2 12h2v2H2zM10 10h2v2h-2zM12 12h2v2h-2z"
            />
          </svg>
        </button>
      </header>
      <div
        className={cn("relative flex min-h-0 flex-1 justify-center overflow-y-auto px-4 py-3", over && "items-start")}
      >
        {over ? (
          <Podium battle={battle} onClose={onClose} />
        ) : isTickKind(kind) ? (
          kind === "pump" ? (
            <PumpGame key={battle.id} {...props} />
          ) : (
            <ArenaGame key={battle.id} {...props} />
          )
        ) : kind === "quiz" ? (
          <QuizGame battle={battle} offsetMs={offsetMs} onState={onState} />
        ) : kind === "estimate" ? (
          <EstimateGame battle={battle} offsetMs={offsetMs} onState={onState} />
        ) : (
          <BellGame battle={battle} offsetMs={offsetMs} onState={onState} />
        )}
        <AnimatePresence>
          {!over && msToStart > -600 && <IntroCard battle={battle} msToStart={msToStart} />}
        </AnimatePresence>
      </div>
    </motion.div>,
    document.body,
  );
}
