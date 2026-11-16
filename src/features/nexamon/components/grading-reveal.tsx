"use client";

import { animate, AnimatePresence, motion, useMotionValue, useReducedMotionConfig, useTransform } from "motion/react";
import { useTranslations } from "next-intl";
import { memo, useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { NexamonArt, NexamonCard } from "@/config/nexamon";
import { BALANCE } from "@/config/balance";
import {
  ASP_INK,
  composeGradingPack,
  PACK_SIZE,
  packTearRow,
  SLAB_LABEL,
  SLAB_SIZE,
} from "@/components/pixel/nexamon-pack";
import { burstConfetti } from "@/components/ui/effects";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { nexamonCopyFactorBps } from "@/lib/sim/nexamon";
import { playSound, stopSound, type SoundName } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { gradeNumber, gradeStepPauseMs, gradeTier, pixelScale, tearProgress, type GradeTier } from "../lib";
import { formatChance, formatFactor } from "../view";
import { PackFoil, PackSheen } from "./pack";
import { GradeChip } from "./parts";
import { PixelCanvas } from "./pixel-canvas";
import { NexamonSlab } from "./slab";
import "./nexamon.css";

/** sealed: the package waits. tearing: the strip comes off. rising: the slab comes up, label covered. counting: the grade counts up. result: the label is uncovered. */
export type GradeRevealPhase = "sealed" | "tearing" | "rising" | "counting" | "result";
export { gradeTier, type GradeTier };

const RESULT_SOUND: Record<GradeTier, SoundName> = {
  low: "gradeLow",
  good: "gradeGood",
  ten: "gradeTen",
  black: "blackLabel",
};

/** Upper part of the package (share of its height) where a tear can start. */
const TEAR_ZONE = 0.45;
const TEAR_TICKS = 9;
const TEAR_MS = 560;
/** The slab rises while the drum rolls. */
const RISE_MS = 1_500;
/** The breath between the last number and the uncovered label; the Black Label holds it longest. */
const HOLD_MS: Record<GradeTier, number> = { low: 450, good: 650, ten: 900, black: 1_700 };

/** The sealed ASP package as a still picture: for lists of slabs that wait to be opened. */
export const GradingPack = memo(function GradingPack({
  scale = 2,
  sheen = true,
  className,
}: {
  scale?: number;
  sheen?: boolean;
  className?: string;
}) {
  const t = useTranslations("nexamon");
  const u = pixelScale(scale);
  return (
    <div
      role="img"
      aria-label={t("reveal.packLabel")}
      data-testid="grading-pack"
      className={cn("relative isolate shrink-0 select-none", className)}
      style={{ width: PACK_SIZE.width * u, height: PACK_SIZE.height * u }}
    >
      <PixelCanvas raster={composeGradingPack().full} scale={u} />
      <PackFoil scale={u} />
      {sheen && <PackSheen scale={u} />}
    </div>
  );
});

export interface GradeRevealProps {
  card: NexamonCard;
  art?: NexamonArt;
  /** The grade the server gave (1..10, 11 = Black Label). It is fixed before the show starts. */
  grade: number;
  serial: number | string;
  /** What the slab is worth; shown with the result. */
  valueCents?: number;
  /** CSS pixels per art pixel of the slab; the package is one step larger. */
  scale?: number;
  sound?: boolean;
  /** The package was torn open. */
  onOpen?: () => void;
  /** The grade is on the table (after the show, a skip, or at once with reduced motion). */
  onResult?: () => void;
  /** Shown under the result: buttons of the page that uses the reveal. */
  children?: ReactNode;
  className?: string;
}

/**
 * A graded card comes back from ASP in a sealed package (ADR-165). The player tears it open like a booster (or
 * uses the button); the slab rises with its label covered while a drum rolls, the grade counts up with pauses
 * that grow towards the top, and then the label is uncovered: a soft note below 8, a chime for 8 and 9, a fanfare
 * with confetti for a 10 and the darkest, biggest moment for the Black Label. "Überspringen" jumps to the result;
 * with reduced motion the result simply fades in. The component owns no game state: the grade is decided long
 * before, so leaving half-way loses nothing.
 */
export function GradeReveal({
  card,
  art,
  grade,
  serial,
  valueCents,
  scale = 2,
  sound = true,
  onOpen,
  onResult,
  children,
  className,
}: GradeRevealProps) {
  const t = useTranslations("nexamon");
  const reduced = useReducedMotionConfig() ?? false;
  const u = pixelScale(scale);
  const pu = u + 1;
  const tier = gradeTier(grade);
  const top = gradeNumber(grade);
  const [phase, setPhase] = useState<GradeRevealPhase>("sealed");
  const [count, setCount] = useState(0);
  const timers = useRef<number[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const tear = useMotionValue(0);
  const [rip, setRip] = useState<-1 | 0 | 1>(0);
  const drag = useRef<{ x: number; ticks: number; dir: -1 | 0 | 1 } | null>(null);
  const side = rip === 0 ? 1 : rip;
  const peel = useTransform(tear, (value) => value * 16 * side);
  const lift = useTransform(tear, (value) => -value * 4 * pu);
  const rasters = composeGradingPack();
  const factor = nexamonCopyFactorBps("mint", grade);
  const rawFactor = 10_000;

  const clear = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);
  useEffect(
    () => () => {
      clear();
      stopSound("gradeDrum");
    },
    [clear],
  );
  const later = useCallback((ms: number, run: () => void) => {
    timers.current.push(window.setTimeout(run, ms));
  }, []);

  /** The label is uncovered: sound, confetti and the hand-over to the page. Runs once. */
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    clear();
    setCount(top);
    setPhase("result");
    stopSound("gradeDrum");
    if (sound) void playSound(RESULT_SOUND[tier]);
    haptic(tier === "low" ? "tap" : "success");
    if (stage.current && (tier === "ten" || tier === "black")) {
      burstConfetti(stage.current, tier === "black" ? 48 : 32);
      if (tier === "black") later(700, () => stage.current && burstConfetti(stage.current, 40));
    }
    onResult?.();
  }, [clear, later, onResult, sound, tier, top]);

  // The result is announced and can be reached with the keyboard right away.
  useEffect(() => {
    if (phase === "result") resultRef.current?.focus({ preventScroll: true });
  }, [phase]);

  const countFrom = (step: number) => {
    if (step > top) {
      later(HOLD_MS[tier], finish);
      return;
    }
    later(gradeStepPauseMs(step), () => {
      setCount(step);
      if (sound) void playSound("gradeTick", 1, { rate: 0.8 + step * 0.09 });
      countFrom(step + 1);
    });
  };

  const open = (byHand = false) => {
    if (phase !== "sealed") return;
    onOpen?.();
    if (sound) void playSound("packTear");
    if (reduced) {
      finish();
      return;
    }
    setPhase("tearing");
    if (!byHand) setRip(1);
    later(TEAR_MS, () => {
      setPhase("rising");
      if (sound) void playSound("gradeDrum");
    });
    later(TEAR_MS + RISE_MS, () => {
      setPhase("counting");
      countFrom(1);
    });
  };

  const tearStart = (event: PointerEvent<HTMLDivElement>) => {
    if (phase !== "sealed") return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientY - rect.top > rect.height * TEAR_ZONE) return;
    drag.current = { x: event.clientX, ticks: 0, dir: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const tearMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || phase !== "sealed") return;
    const dx = event.clientX - d.x;
    if (d.dir === 0) {
      if (Math.abs(dx) < 4) return;
      d.dir = dx > 0 ? 1 : -1;
      setRip(d.dir);
    }
    const progress = tearProgress(dx * d.dir, event.currentTarget.getBoundingClientRect().width);
    tear.set(progress);
    const ticks = Math.floor(progress * TEAR_TICKS);
    if (ticks > d.ticks) {
      d.ticks = ticks;
      if (sound) void playSound("packCrinkle");
    }
    if (progress >= 1) {
      drag.current = null;
      open(true);
    }
  };
  const tearEnd = () => {
    if (!drag.current) return;
    drag.current = null;
    animate(tear, 0, { ...SPRING.snappy, onComplete: () => setRip(0) });
  };

  const packW = PACK_SIZE.width * pu;
  const packH = PACK_SIZE.height * pu;
  const slabW = SLAB_SIZE.width * u;
  const slabH = SLAB_SIZE.height * u;
  const showSlab = phase === "rising" || phase === "counting" || phase === "result";
  const showPack = phase === "sealed" || phase === "tearing";
  const covered = phase !== "result";
  // How far the light has built up: with the rise, then with every counted step.
  const heat = phase === "rising" ? 0.25 : phase === "counting" ? 0.3 + (count / 10) * 0.7 : phase === "result" ? 1 : 0;
  const l = SLAB_LABEL;

  return (
    <div
      data-testid="grade-reveal"
      data-phase={phase}
      data-tier={phase === "result" ? tier : undefined}
      className={cn("flex w-full flex-col items-center gap-3", className)}
    >
      <div
        ref={stage}
        className="relative flex w-full items-center justify-center overflow-hidden"
        style={{ height: Math.max(packH, slabH) + 28 * u }}
      >
        {/* The Black Label takes the light away before it lands. */}
        {tier === "black" && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-black-label"
            initial={false}
            animate={{ opacity: phase === "result" ? 0.55 : phase === "counting" && count >= top ? 0.85 : 0 }}
            transition={{ duration: DURATION.slower, ease: EASE.inOut }}
          />
        )}

        {/* Light behind the slab: it grows with the suspense and takes the colour of the result. */}
        {showSlab && !reduced && (
          <motion.div
            aria-hidden
            data-testid="grade-glow"
            className="pointer-events-none absolute"
            style={{ width: slabW * 1.9, height: slabW * 1.9 }}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: tier === "low" && phase === "result" ? 0.15 : heat, scale: 0.6 + heat * 0.5 }}
            transition={{ duration: DURATION.slower, ease: EASE.out }}
          >
            <div
              className={cn(
                "absolute inset-0",
                phase !== "result"
                  ? "nexamon-burst"
                  : tier === "black"
                    ? "nexamon-glow-black nexamon-glow-pulse"
                    : tier === "ten"
                      ? "nexamon-glow-legendary nexamon-glow-pulse"
                      : tier === "good"
                        ? "nexamon-glow-ultra"
                        : "nexamon-glow-rare",
              )}
            />
            {(phase !== "result" || tier === "ten" || tier === "black") && (
              <div
                className={cn(
                  "nexamon-spin absolute inset-0",
                  phase === "result" && tier === "black" ? "nexamon-rays-silver" : "nexamon-rays",
                )}
              />
            )}
          </motion.div>
        )}

        <AnimatePresence>
          {showPack && (
            <motion.div
              key="pack"
              exit={{ opacity: 0, y: packH * 0.45, transition: { duration: DURATION.slower, ease: EASE.in } }}
              className="absolute"
              style={{ width: packW, height: packH }}
            >
              <div
                onPointerDown={tearStart}
                onPointerMove={tearMove}
                onPointerUp={tearEnd}
                onPointerCancel={tearEnd}
                data-testid="grade-tear"
                data-ripping={rip !== 0}
                className={cn(
                  "relative block size-full touch-pan-y select-none",
                  phase === "sealed" && "cursor-grab active:cursor-grabbing",
                )}
              >
                <PixelCanvas
                  raster={phase === "tearing" || rip !== 0 ? rasters.body : rasters.full}
                  scale={pu}
                  className="absolute inset-0"
                />
                {phase !== "tearing" && rip !== 0 && (
                  <motion.div
                    className="absolute inset-0"
                    style={{ rotate: peel, y: lift, transformOrigin: rip > 0 ? "100% 10%" : "0% 10%" }}
                  >
                    <PixelCanvas raster={rasters.top} scale={pu} />
                  </motion.div>
                )}
                {phase === "tearing" && (
                  <motion.div
                    className="absolute inset-0"
                    initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
                    animate={{ x: packW * 0.55 * side, y: -packH * 0.3, rotate: 38 * side, opacity: 0 }}
                    transition={{ duration: TEAR_MS / 1000, ease: EASE.out }}
                    style={{ transformOrigin: side > 0 ? "100% 0%" : "0% 0%" }}
                  >
                    <PixelCanvas raster={rasters.top} scale={pu} />
                  </motion.div>
                )}
                {phase === "sealed" && (
                  <>
                    <PackFoil scale={pu} />
                    <PackSheen scale={pu} />
                    {rip === 0 && (
                      <div
                        aria-hidden
                        className="nexamon-tear-guide pointer-events-none absolute"
                        style={{ left: 3 * pu, right: 3 * pu, top: packTearRow(0) * pu + pu }}
                      />
                    )}
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {showSlab && (
          <motion.div
            data-testid="grade-slab"
            data-covered={covered}
            className="relative"
            style={{ width: slabW, height: slabH }}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: slabH * 0.55, scale: 0.86 }}
            animate={
              phase === "result" && !reduced
                ? { opacity: 1, y: 0, scale: tier === "low" ? 1 : [1, tier === "black" ? 1.14 : 1.08, 1] }
                : { opacity: 1, y: 0, scale: 1 }
            }
            transition={
              phase === "result"
                ? { duration: DURATION.slower, ease: EASE.out }
                : { duration: RISE_MS / 1000, ease: EASE.out }
            }
          >
            {/* Hidden from assistive technology until the label is uncovered: the slab knows its grade. */}
            <div aria-hidden={covered}>
              <NexamonSlab
                card={card}
                art={art}
                grade={grade}
                serial={serial}
                scale={u}
                tilt={false}
                flippable={false}
              />
            </div>
            {/* The cover over the label: it slides off when the grade is on the table. */}
            <motion.div
              aria-hidden
              data-testid="grade-cover"
              className="absolute grid place-items-center overflow-hidden font-pixel text-on-black-label"
              style={{
                left: (l.x - 1) * u,
                top: (l.y - 1) * u,
                width: (l.w + 2) * u,
                height: (l.h + 2) * u,
                backgroundColor: ASP_INK.brandDark,
                fontSize: u * 6,
              }}
              initial={false}
              animate={covered ? { opacity: 1, y: 0 } : { opacity: 0, y: -(l.h + 6) * u }}
              transition={{ duration: reduced ? DURATION.base : DURATION.slower, ease: EASE.in }}
            >
              {t("reveal.cover")}
            </motion.div>
          </motion.div>
        )}

        {/* The number counting up, large over the slab. */}
        {phase === "counting" && (
          <div className="pointer-events-none absolute inset-x-0 top-1 flex justify-center" aria-hidden>
            <motion.span
              key={count}
              data-testid="grade-count"
              initial={{ scale: 1.5, opacity: 0.4 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={SPRING.bouncy}
              className={cn(
                "rounded-md px-4 py-1 font-pixel nums text-4xl shadow-2",
                tier === "black" && count >= top ? "bg-black-label text-on-black-label" : "bg-surface-1 text-fg-1",
              )}
            >
              {count === 0 ? "…" : count}
            </motion.span>
          </div>
        )}

        {/* The stamp and the flash of the Black Label. */}
        {phase === "result" && tier === "black" && !reduced && (
          <>
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-on-black-label"
              initial={{ opacity: 0.95 }}
              animate={{ opacity: 0 }}
              transition={{ duration: DURATION.slower * 2, ease: EASE.out }}
            />
            <motion.p
              aria-hidden
              data-testid="black-label-stamp"
              className="pointer-events-none absolute top-2 border-2 border-black-label-edge bg-black-label px-3 py-1 font-pixel text-lg text-on-black-label uppercase shadow-3"
              initial={{ scale: 3, opacity: 0, rotate: -8 }}
              animate={{ scale: 1, opacity: 1, rotate: -4 }}
              transition={SPRING.bouncy}
            >
              {t("blackLabel.short")}
            </motion.p>
          </>
        )}
        {phase === "result" && tier === "ten" && !reduced && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gold"
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 0 }}
            transition={{ duration: DURATION.slower, ease: EASE.out }}
          />
        )}
      </div>

      <div className="min-h-16 w-full text-center" aria-live="polite">
        {phase === "sealed" && (
          <>
            <p className="text-sm text-pretty text-fg-2">{t("reveal.tearHint")}</p>
            <button
              type="button"
              onClick={() => open()}
              data-testid="grade-open"
              className="mt-2 h-9 rounded-sm px-3 text-xs font-medium text-accent focus-ring transition-colors duration-fast hover:bg-surface-2 active:scale-[0.98]"
            >
              {t("reveal.openButton")}
            </button>
          </>
        )}
        {(phase === "tearing" || phase === "rising" || phase === "counting") && (
          <>
            <p className="label-pixel text-fg-2">{phase === "counting" ? t("reveal.counting") : t("reveal.rising")}</p>
            <button
              type="button"
              onClick={finish}
              data-testid="grade-skip"
              className="mt-2 h-9 rounded-sm px-3 text-xs font-medium text-accent focus-ring transition-colors duration-fast hover:bg-surface-2 active:scale-[0.98]"
            >
              {t("reveal.skip")}
            </button>
          </>
        )}
        {phase === "result" && (
          <motion.div
            ref={resultRef}
            tabIndex={-1}
            data-testid="grade-result"
            data-grade={grade}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: DURATION.slow, ease: EASE.out, delay: reduced ? 0 : DURATION.slow }}
            className="flex flex-col items-center gap-1.5 outline-none"
          >
            <p className="font-pixel text-sm text-fg-1 uppercase">{t(`reveal.tier.${tier}`)}</p>
            <GradeChip grade={grade} />
            {valueCents !== undefined && (
              <p className="nums text-lg font-semibold text-fg-1" data-testid="grade-value">
                {formatMoney(valueCents)}
              </p>
            )}
            <p className={cn("nums text-xs", factor > rawFactor ? "text-gain" : "text-loss")}>
              {t("grading.factor", { factor: formatFactor(factor) })}
            </p>
            {tier === "black" && (
              <p className="max-w-sm text-xs text-pretty text-fg-2">
                {t("reveal.blackText", {
                  chance: formatChance(BALANCE.nexamon.grading.blackLabel.chanceBps),
                })}
              </p>
            )}
            {children}
          </motion.div>
        )}
      </div>
    </div>
  );
}
