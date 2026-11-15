"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { ROCKET } from "@/components/pixel/battle-art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { PlayerFigure } from "@/components/ui/player-figure";
import type { Battle } from "@/features/game/battle-types";
import { GOLDEN, RED, YELLOW, pumpLight, type PumpState } from "@/lib/sim/battle/pump";
import { formatCountdown } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useBattleKeys, useLockstep } from "./use-lockstep";

/*
 * Aktie pumpen (ADR-160): every player's stock climbs like a rocket on its own lane; the traffic light on top says
 * when tapping pumps (green, golden ×3) and when it crashes you (red). Tap the big button or the space bar.
 */

interface View {
  light: number;
  scores: number[];
  busts: number[];
  frozen: number[];
  out: number[];
  leftMs: number;
}

export function PumpGame({
  battle,
  offsetMs,
  onFinished,
}: {
  battle: Battle;
  offsetMs: number;
  onFinished: () => void;
}) {
  const t = useTranslations("battle");
  const { lockstep, finished } = useLockstep(battle, offsetMs);
  const [view, setView] = useState<View | null>(null);
  const [pressed, setPressed] = useState(false);
  const [busted, setBusted] = useState(0);
  const [showBust, setShowBust] = useState(false);
  const last = useRef<{ light: number; busts: number }>({ light: -1, busts: 0 });
  const me = lockstep?.mySlot ?? null;
  const onTap = useCallback(() => {
    setPressed(true);
    haptic("tap");
    void playSound("battlePump");
    window.setTimeout(() => setPressed(false), 70);
  }, []);
  const keys = useBattleKeys(lockstep, onTap);

  useEffect(() => {
    if (finished) onFinished();
  }, [finished, onFinished]);

  useEffect(() => {
    if (!lockstep) return;
    let frame = 0;
    let lastSet = 0;
    const loop = () => {
      const now = Date.now();
      lockstep.record(now);
      if (now - lastSet > 50) {
        lastSet = now;
        const s = lockstep.view(now).state as PumpState;
        const light = pumpLight(s, Math.max(0, s.tick - 1));
        if (light !== last.current.light) {
          if (light === RED) void playSound("warning");
          if (light === GOLDEN) void playSound("battleGold");
          last.current.light = light;
        }
        if (me !== null && s.busts[me]! > last.current.busts) {
          last.current.busts = s.busts[me]!;
          setBusted((n) => n + 1);
          setShowBust(true);
          window.setTimeout(() => setShowBust(false), 1200);
          void playSound("battleBust");
          haptic("error");
        }
        const total = lockstep.maxTicks * lockstep.params.tickMs;
        setView({
          light,
          scores: [...s.score],
          busts: [...s.busts],
          frozen: [...s.frozen],
          out: [...s.p.out],
          leftMs: Math.max(0, total - Math.max(0, now + lockstep.offsetMs - Date.parse(battle.startedAt!))),
        });
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [lockstep, me, battle.startedAt]);

  const players = battle.players.filter((p) => p.slot !== null);
  const max = Math.max(10, ...(view?.scores ?? [0]));
  const light = view?.light ?? 0;
  const lightText =
    light === RED
      ? t("pump.red")
      : light === YELLOW
        ? t("pump.yellow")
        : light === GOLDEN
          ? t("pump.gold")
          : t("pump.green");
  const many = players.length > 6;

  return (
    <div
      className="flex h-full w-full max-w-3xl flex-col items-center gap-3"
      data-testid="battle-pump"
      data-light={light}
    >
      <div className="flex w-full items-center justify-between gap-3">
        <span className="font-pixel nums text-fg-1">{view ? formatCountdown(view.leftMs / 1000) : "--:--"}</span>
        <div className="flex items-center gap-3 rounded-pill border-2 border-line-2 bg-surface-1 px-3 py-1.5 shadow-2">
          {[RED, YELLOW, 0].map((l) => (
            <span
              key={l}
              aria-hidden
              className={cn(
                "size-5 rounded-full ring-2 ring-line-2 transition duration-fast",
                l === RED && "bg-loss",
                l === YELLOW && "bg-warn",
                l === 0 && (light === GOLDEN ? "bg-gold" : "bg-gain"),
                l === light || (l === 0 && (light === 0 || light === GOLDEN))
                  ? "scale-110 opacity-100 shadow-3"
                  : "scale-90 opacity-25",
              )}
            />
          ))}
        </div>
        <span className="w-12" />
      </div>
      <motion.p
        key={light}
        initial={{ scale: 1.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: DURATION.base, ease: EASE.out }}
        className={cn(
          "font-pixel text-xl",
          light === RED ? "text-loss" : light === YELLOW ? "text-warn" : light === GOLDEN ? "text-gold" : "text-gain",
        )}
        aria-live="polite"
      >
        {lightText}
      </motion.p>
      <div
        className={cn(
          "relative flex w-full flex-1 items-end justify-center gap-1 overflow-hidden rounded-md border-2 border-line-2 bg-surface-1 px-2 pt-8 pb-2 sm:gap-3",
          light === RED && "animate-pulse-danger",
        )}
      >
        {players.map((p) => {
          const slot = p.slot!;
          const score = view?.scores[slot] ?? 0;
          const share = Math.min(1, score / max);
          const isMe = slot === me;
          const frozen = (view?.frozen[slot] ?? 0) > 0;
          return (
            <div
              key={slot}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
              data-testid="pump-lane"
            >
              <span className={cn("font-pixel nums text-2xs sm:text-xs", isMe ? "text-accent" : "text-fg-2")}>
                {score}
              </span>
              <div className="relative min-h-40 w-full max-w-12 flex-1">
                <div className="absolute inset-x-0 bottom-0 h-full rounded-xs bg-surface-2" />
                <div
                  className={cn(
                    "absolute inset-x-0 bottom-0 h-full origin-bottom rounded-xs transition-transform duration-fast ease-out",
                    frozen ? "bg-loss" : isMe ? "bg-accent" : "bg-gain",
                  )}
                  style={{ transform: `scaleY(${share})` }}
                />
                <div
                  className="absolute inset-0 flex items-end justify-center transition-transform duration-fast ease-out"
                  style={{ transform: `translateY(${-share * 100}%)` }}
                >
                  <div className="translate-y-1">
                    <PixelIcon {...ROCKET} scale={2} />
                  </div>
                </div>
              </div>
              <div className={cn("transition-transform duration-instant", isMe && pressed && "translate-y-1")}>
                <PlayerFigure avatarKey={p.avatarKey} accessories={p.accessories} scale={many ? 1 : 2} />
              </div>
              <span className={cn("max-w-full truncate text-2xs", isMe ? "font-semibold text-accent" : "text-fg-3")}>
                {isMe ? t("you") : p.nickname}
              </span>
            </div>
          );
        })}
        <AnimatePresence>
          {showBust && (
            <motion.p
              key={busted}
              initial={{ y: 10, opacity: 0, scale: 0.8 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute top-2 left-1/2 -translate-x-1/2 rounded-sm bg-loss px-3 py-1 font-pixel text-xs text-on-semantic"
            >
              {t("pump.busted")}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      {me !== null && (
        <button
          type="button"
          data-testid="battle-pump-button"
          onPointerDown={(e) => {
            e.preventDefault();
            keys.tap();
          }}
          className={cn(
            "h-20 w-full max-w-md touch-none rounded-lg border-2 font-pixel text-2xl uppercase shadow-3 focus-ring select-none",
            "transition-transform duration-instant",
            pressed ? "scale-95" : "scale-100",
            light === RED ? "border-loss bg-loss-soft text-loss" : "border-gain bg-gain text-on-semantic",
          )}
        >
          {t("pump.tap")}
        </button>
      )}
      <p className="text-2xs text-fg-3">{t("controls.tapKeys")}</p>
    </div>
  );
}
