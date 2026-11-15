"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { BULL, CUE_ARROW, FENCE } from "@/components/pixel/battle-art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { PlayerFigure } from "@/components/ui/player-figure";
import type { Battle } from "@/features/game/battle-types";
import { RODEO_HIT, RODEO_MISS, type RodeoState } from "@/lib/sim/battle/rodeo";
import { formatCountdown } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/stores/settings";
import { useCoarsePointer } from "./arena-game";
import { Hearts } from "./parts";
import { useBattleKeys, useLockstep } from "./use-lockstep";

/*
 * Bullen-Rodeo (ADR-160, addendum): everybody rides a pixel bull in the ring. The bull bucks in a direction (the
 * big arrow), the rider has to press it in time; the window bar runs down. Riders who miss lose grip and wobble;
 * without grip they are thrown off. The lockstep runs the same simulation as the server.
 */

interface View {
  cue: number;
  dir: number;
  /** 0..1 of the window left, -1 between cues. */
  left: number;
  resp: number[];
  last: number[];
  lastEnd: number;
  tick: number;
  grip: number[];
  score: number[];
  out: number[];
  leftMs: number;
}

/** Quarter turns of the arrow for the directions 1 up, 2 right, 3 down, 4 left. */
const TURN = [0, 0, 90, 180, 270];
/** How the bull bucks in each direction (transform only). */
const BUCK: Record<number, { rotate: number; x: number; y: number }> = {
  0: { rotate: 0, x: 0, y: 0 },
  1: { rotate: -14, x: 0, y: -8 },
  2: { rotate: 8, x: 6, y: -2 },
  3: { rotate: 12, x: 0, y: 4 },
  4: { rotate: -8, x: -6, y: -2 },
};
const DIR_KEYS = ["up", "right", "down", "left"] as const;

export function RodeoGame({
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
  const keys = useBattleKeys(lockstep);
  const coarse = useCoarsePointer();
  const [view, setView] = useState<View | null>(null);
  const [shake, setShake] = useState(0);
  const last = useRef({ cue: -1, lastEnd: -1, grip: -1, out: false });
  const me = lockstep?.mySlot ?? null;
  const reduced = prefersReducedMotion();

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
      if (now - lastSet > 40) {
        lastSet = now;
        const s = lockstep.view(now).state as RodeoState;
        const open = s.cueStart >= 0;
        if (open && s.cue !== last.current.cue) {
          last.current.cue = s.cue;
          void playSound("battleBuck");
        }
        if (me !== null && s.lastEnd !== last.current.lastEnd && s.lastEnd >= 0) {
          last.current.lastEnd = s.lastEnd;
          if (s.last[me] === RODEO_HIT) {
            void playSound("battleWhoosh");
            haptic("tap");
          } else if (s.last[me] === RODEO_MISS && s.p.out[me]! < 0) {
            void playSound("battleHit");
            haptic("error");
            setShake((k) => k + 1);
          }
        }
        if (me !== null && s.p.out[me]! >= 0 && !last.current.out) {
          last.current.out = true;
          void playSound("battleFall");
          setShake((k) => k + 1);
        }
        const total = lockstep.maxTicks * lockstep.params.tickMs;
        setView({
          cue: s.cue,
          dir: open ? s.cueDir : 0,
          left: open ? Math.max(0, (s.cueStart + s.cueWin - s.tick) / s.cueWin) : -1,
          resp: [...s.resp],
          last: [...s.last],
          lastEnd: s.lastEnd,
          tick: s.tick,
          grip: [...s.grip],
          score: [...s.score],
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
  const grip = Number(battle.params?.game.grip ?? 3);
  const dir = view?.dir ?? 0;
  const mine = me !== null && view ? view.resp[me] : 0;
  const myOut = me !== null && (view?.out[me] ?? -1) >= 0;
  const status = !view
    ? t("rodeo.ready")
    : myOut
      ? t("rodeo.thrown")
      : dir > 0
        ? mine === RODEO_HIT
          ? t("rodeo.hit")
          : mine === RODEO_MISS
            ? t("rodeo.miss")
            : t("rodeo.now")
        : t("rodeo.ready");
  const star = players.find((p) => p.slot === me);
  const others = players.filter((p) => p.slot !== me);

  /** A rider on a bull; the bull bucks with the cue unless the rider held on. */
  const rider = (p: (typeof players)[number], big: boolean) => {
    const slot = p.slot!;
    const out = (view?.out[slot] ?? -1) >= 0;
    const resp = view?.resp[slot] ?? 0;
    const hit = resp === RODEO_HIT;
    const wobble = dir > 0 && !hit ? BUCK[dir]! : BUCK[0]!;
    const k = big ? 1.6 : 1;
    // phones: a smaller star, and the others small once there are many
    const figure = big ? (coarse ? 2 : 3) : coarse && others.length > 4 ? 1 : 2;
    const bull = big ? (coarse ? 4 : 6) : coarse && others.length > 4 ? 2 : 3;
    return (
      <li
        key={slot}
        className={cn("flex min-w-0 flex-col items-center", out && "opacity-40 grayscale")}
        data-testid="rodeo-rider"
      >
        <motion.div
          className="relative flex flex-col items-center"
          animate={
            reduced
              ? undefined
              : out
                ? { rotate: 80, x: 24, y: 14 }
                : { rotate: wobble.rotate, x: wobble.x * k, y: wobble.y * k }
          }
          transition={{ ...SPRING.bouncy }}
        >
          <div className={cn("transition-transform duration-fast", big ? "-mb-5" : "-mb-3", hit && "-translate-y-1")}>
            <PlayerFigure avatarKey={p.avatarKey} accessories={p.accessories} scale={figure} />
          </div>
          <PixelIcon {...BULL} scale={bull} />
          <AnimatePresence>
            {hit && (
              <motion.span
                key={`hit-${view?.cue}`}
                initial={{ y: 0, opacity: 0, scale: 0.6 }}
                animate={{ y: -22, opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className={cn("absolute top-0 font-pixel text-gain", big ? "text-lg" : "text-xs")}
              >
                +
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
        <span
          className={cn(
            "mt-1 max-w-24 truncate rounded-xs px-1 text-2xs",
            p.me ? "bg-accent text-on-accent" : "bg-surface-1/80 text-fg-2",
          )}
        >
          {p.me ? t("you") : p.nickname}
        </span>
        <span className="flex items-center gap-1 rounded-xs bg-surface-1/80 px-1">
          <Hearts count={view?.grip[slot] ?? grip} max={grip} scale={big ? 2 : 1} />
          <span className="font-pixel nums text-2xs text-fg-2">{view?.score[slot] ?? 0}</span>
        </span>
      </li>
    );
  };

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-3" data-testid="battle-rodeo" data-dir={dir}>
      <div className="flex w-full items-center justify-between gap-3">
        <span className="font-pixel nums text-fg-1">{view ? formatCountdown(view.leftMs / 1000) : "--:--"}</span>
        <p
          className={cn(
            "font-pixel text-lg",
            mine === RODEO_HIT ? "text-gain" : mine === RODEO_MISS || myOut ? "text-loss" : "text-fg-1",
          )}
          aria-live="polite"
        >
          {status}
        </p>
        <span className="font-pixel nums text-xs text-fg-2">
          {me !== null && view ? t("rodeo.points", { points: view.score[me] ?? 0 }) : ""}
        </span>
      </div>
      <motion.div
        key={shake}
        animate={reduced || shake === 0 ? undefined : { x: [0, -8, 7, -5, 3, 0] }}
        transition={{ duration: DURATION.slow, ease: EASE.out }}
        className="relative isolate w-full shrink-0 overflow-hidden rounded-md border-2 border-line-2 bg-surface-1 shadow-2"
      >
        {/* the cue: a big arrow and the window running down */}
        <div className="relative grid h-28 w-full place-items-center bg-spotlight">
          <AnimatePresence mode="popLayout">
            {dir > 0 ? (
              <motion.div
                key={`cue-${view?.cue}`}
                initial={{ scale: 2.2, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ ...SPRING.bouncy }}
                data-testid="rodeo-cue"
              >
                <div style={{ transform: `rotate(${TURN[dir]}deg)` }}>
                  <PixelIcon {...CUE_ARROW} scale={5} title={t(`rodeo.${DIR_KEYS[dir - 1]!}`)} />
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="wait"
                initial={{ opacity: 0 }}
                animate={reduced ? { opacity: 0.5 } : { opacity: [0.25, 0.6, 0.25] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.2, repeat: Infinity }}
                aria-hidden
              >
                <PixelIcon {...CUE_ARROW} scale={3} className="grayscale" />
              </motion.div>
            )}
          </AnimatePresence>
          {view && view.left >= 0 && (
            <div className="absolute inset-x-6 bottom-2 h-2 overflow-hidden rounded-pill bg-surface-3">
              <div
                className={cn(
                  "h-full origin-left rounded-pill transition-transform duration-instant ease-linear",
                  view.left < 0.35 ? "bg-loss" : "bg-gold",
                )}
                style={{ transform: `scaleX(${view.left})` }}
              />
            </div>
          )}
        </div>
        {/* the ring: a fence at the back, sand, the riders */}
        <div className="relative">
          <div aria-hidden className="absolute inset-x-0 top-0 -z-10 flex h-14 overflow-hidden opacity-80">
            {Array.from({ length: 24 }, (_, i) => (
              <PixelIcon key={i} {...FENCE} scale={4} className="shrink-0" />
            ))}
          </div>
          <div aria-hidden className="absolute inset-x-0 top-11 bottom-0 -z-10 bg-warn-soft" />
          {star && <ul className="flex justify-center pt-6 pb-2">{rider(star, true)}</ul>}
          <ul
            className={cn("flex flex-wrap items-end justify-center gap-x-3 gap-y-3 px-2 pb-3", star ? "pt-1" : "pt-8")}
          >
            {others.map((p) => rider(p, false))}
          </ul>
        </div>
      </motion.div>
      {me !== null && !myOut && coarse && <ArrowPad className="shrink-0" onChange={(d) => keys.setTouch(d, false)} />}
      <p className="text-2xs text-fg-3">{coarse ? t("controls.rodeoTouch") : t("controls.rodeoKeys")}</p>
    </div>
  );
}

/** Four big arrow buttons: a press is a new direction, letting go is none. */
export function ArrowPad({ onChange, className }: { onChange: (dir: number) => void; className?: string }) {
  const t = useTranslations("battle.rodeo");
  const [held, setHeld] = useState(0);
  const press = (d: number) => {
    setHeld(d);
    haptic("tap");
    onChange(d);
  };
  const release = () => {
    setHeld(0);
    onChange(0);
  };
  const button = (d: number, area: string) => (
    <button
      key={d}
      type="button"
      aria-label={t(DIR_KEYS[d - 1]!)}
      className={cn(
        "grid size-16 touch-none place-items-center rounded-md border-2 shadow-2 focus-ring select-none",
        "transition-transform duration-instant",
        held === d ? "scale-90 border-gold bg-warn-soft" : "border-line-2 bg-surface-2",
        area,
      )}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        press(d);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      data-testid={`rodeo-pad-${d}`}
    >
      <span style={{ transform: `rotate(${TURN[d]}deg)` }}>
        <PixelIcon {...CUE_ARROW} scale={2} />
      </span>
    </button>
  );
  return (
    <div className={cn("grid grid-cols-3 grid-rows-2 gap-2", className)} data-testid="rodeo-pad">
      {button(1, "col-start-2 row-start-1")}
      {button(4, "col-start-1 row-start-2")}
      {button(3, "col-start-2 row-start-2")}
      {button(2, "col-start-3 row-start-2")}
    </div>
  );
}
