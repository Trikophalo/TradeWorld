"use client";

import { animate, AnimatePresence, motion, useMotionValue, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { NexamonRarity } from "@/config/nexamon";
import { burstConfetti, pixelSparks } from "@/components/ui/effects";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { playSound, stopSound, type SoundName } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { REVEAL_CHARGE_MS, REVEAL_COUNT_MS, REVEAL_PARTICLES, revealTier, type RevealTier } from "../lib";
import "./nexamon.css";

/** The better the pull, the bigger its sound; a common only ticks. */
export const REVEAL_SOUND: Record<NexamonRarity, SoundName> = {
  common: "cardShow",
  rare: "pullRare",
  ultra: "pullUltra",
  prisma: "pullPrisma",
  legendary: "pullLegendary",
  one_of_one: "pullOneOfOne",
  iron: "cardShow",
  titanium: "pullUltra",
  diamond: "pullLegendary",
  uranium: "pullUranium",
};

/** Pixel confetti of the reveal, in the colours of the rarity's glow (palette data, like the glow in nexamon.css). */
const REVEAL_COLORS: Record<NexamonRarity, readonly string[]> = {
  common: ["var(--fg-2)"],
  rare: ["rgb(170 220 255)", "rgb(120 170 255)", "var(--fg-1)"],
  ultra: ["rgb(255 240 170)", "rgb(255 190 60)", "var(--gold)", "rgb(255 255 255)"],
  prisma: ["rgb(255 90 110)", "rgb(255 230 90)", "rgb(100 230 140)", "rgb(90 200 255)", "rgb(210 120 255)"],
  legendary: ["rgb(255 214 94)", "rgb(255 170 30)", "rgb(255 255 255)", "var(--gold)"],
  one_of_one: ["rgb(255 227 138)", "rgb(154 124 255)", "rgb(63 240 208)", "rgb(255 255 255)", "var(--gold)"],
  iron: ["var(--fg-2)"],
  titanium: ["rgb(230 242 255)", "rgb(120 160 210)", "rgb(255 255 255)"],
  diamond: ["rgb(255 255 255)", "rgb(140 220 255)", "rgb(200 160 255)", "rgb(140 255 230)"],
  uranium: ["rgb(240 255 210)", "rgb(125 255 58)", "rgb(47 191 42)", "rgb(255 255 255)"],
};

/** Spinning glows: the rainbow ones. */
const SPIN: ReadonlySet<NexamonRarity> = new Set(["prisma", "diamond"]);

export type RareRevealPhase = "veiled" | "charging" | "revealed";

export interface RareRevealProps {
  /** Rarity of the card: colour of glow, particles and banner, and the pull sound. */
  rarity: NexamonRarity;
  /** The face of the card (shown once revealed). It sets the size of the reveal. */
  front: ReactNode;
  /** The back of the card (shown while veiled and charging). Laid over the face, same size. */
  back: ReactNode;
  /** Card size in CSS pixels: the glow, the shake and the banner are measured from it. */
  width: number;
  height: number;
  /**
   * false: the card waits face down with a faint glow leaking out (e.g. still under another card).
   * true: charge-up (shake, rising glow, rising sound), then the card turns with flash, confetti, banner and value.
   * Turning it back to false does not hide the card again.
   */
  play: boolean;
  /** Value of the pulled copy in cents: rolls up under the card. Without it no value is shown. */
  valueCents?: number;
  /** How big the moment is (1..4); default from the rarity (`revealTier`). Tier 0 turns the card at once. */
  tier?: RevealTier;
  /** Plays the charge, the pull sound and the ticks of the value. */
  sound?: boolean;
  /** Vibrates on start and landing (the player's haptics setting still applies). */
  haptics?: boolean;
  /** Shows the banner ("Riesentreffer!") over the card after the turn. */
  banner?: boolean;
  /** The face is visible (charge over). */
  onRevealed?: () => void;
  /** Value rolled up, banner gone: the moment is over. */
  onSettled?: () => void;
  /** Gets a handle to skip the charge-up (an impatient tap): the card turns at once, the celebration still plays. */
  controlRef?: RefObject<RareRevealControl | null>;
  className?: string;
  testId?: string;
}

export interface RareRevealControl {
  /** Ends the charge-up now; does nothing while veiled or once revealed. */
  skip: () => void;
}

/** Keyframes of the charge-up shake: alternating, growing towards the turn. */
function shakeFrames(amplitude: number, steps: number): number[] {
  const frames = [0];
  for (let k = 1; k < steps; k++) frames.push((k % 2 === 0 ? 1 : -1) * amplitude * (k / steps) ** 1.6);
  frames.push(0);
  return frames;
}

/**
 * ADR-204: a number that rolls up from `from` to `to` once `run` turns true, with a tick sound every tenth of the
 * way. With reduced motion (or `ms` 0) it jumps. Returns the number to show and whether it has arrived.
 */
export function useRollUp(
  to: number,
  {
    run,
    ms,
    from = 0,
    sound = true,
    delayMs = 0,
  }: { run: boolean; ms: number; from?: number; sound?: boolean; delayMs?: number },
): { value: number; done: boolean } {
  const reduced = useReducedMotionConfig() ?? false;
  const motionValue = useMotionValue(from);
  const [value, setValue] = useState(from);
  const started = useRef(false);
  const instant = reduced || ms <= 0;
  useEffect(() => {
    if (!run || started.current || instant) return;
    started.current = true;
    let step = -1;
    const controls = animate(motionValue, to, {
      duration: ms / 1000,
      delay: delayMs / 1000,
      ease: EASE.out,
      onUpdate: (v) => {
        setValue(Math.round(v));
        const next = Math.floor(((v - from) / Math.max(1, to - from)) * 10);
        if (sound && next !== step && next < 10) {
          step = next;
          void playSound("gradeTick", 0.5, { rate: 1 + next * 0.08 });
        }
      },
      onComplete: () => setValue(to),
    });
    return () => controls.stop();
    // runs once per start
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);
  if (instant) return { value: run ? to : from, done: run };
  return { value: run ? value : from, done: run && value === to };
}

/**
 * ADR-204: a flash over the whole screen in the colours of a rarity glow (`glow`: a nexamon-glow-* class) with a
 * white core. Mounted on the body, so no transformed parent pins it. Change `flashKey` to flash again; 0 = none.
 */
export function ScreenFlash({
  flashKey,
  glow,
  strength = 0.7,
  seconds = DURATION.slower * 2,
  testId = "screen-flash",
}: {
  flashKey: number;
  glow: string;
  strength?: number;
  seconds?: number;
  testId?: string;
}) {
  const reduced = useReducedMotionConfig() ?? false;
  if (flashKey === 0 || reduced || typeof document === "undefined") return null;
  return createPortal(
    <motion.div
      key={flashKey}
      aria-hidden
      data-testid={testId}
      className="pointer-events-none fixed inset-0 z-celebration"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, strength, 0] }}
      transition={{ duration: seconds, times: [0, 0.18, 1], ease: EASE.out }}
    >
      <div className={cn("absolute -inset-1/4", glow)} />
      <div className="nexamon-burst absolute inset-0" />
    </motion.div>,
    document.body,
  );
}

/**
 * ADR-204: the escalating reveal of a big pull. The card lies face down with its glow leaking out, shakes harder
 * and harder while the glow and a rising sound charge up, then turns with a screen flash, pixel confetti in the
 * rarity's colours, a banner and the value rolling up. Bigger tiers wait longer and celebrate louder.
 * Only transform and opacity move; with reduced motion (system or the "Animationen" setting) the card turns at once
 * and banner and value simply stand there. Owns no game state: give it the card's faces and say when to play.
 */
export function RareReveal({
  rarity,
  front,
  back,
  width,
  height,
  play,
  valueCents,
  tier: tierProp,
  sound = true,
  haptics = true,
  banner = true,
  onRevealed,
  onSettled,
  controlRef,
  className,
  testId = "rare-reveal",
}: RareRevealProps) {
  const t = useTranslations("nexamon.rareReveal");
  const tr = useTranslations("nexamonCards");
  const reduced = useReducedMotionConfig() ?? false;
  const tier = tierProp ?? revealTier(rarity);
  const charge = REVEAL_CHARGE_MS[tier];
  // the phase follows `play`; only the landing is state (set from a timer or a skip)
  const [landed, setLanded] = useState(false);
  const instant = reduced || tier === 0;
  const phase: RareRevealPhase = landed || (play && instant) ? "revealed" : play ? "charging" : "veiled";
  const started = useRef(false);
  const [flash, setFlash] = useState(0);
  const [settled, setSettled] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onRevealed, onSettled });
  const skipRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!controlRef) return;
    const control: RareRevealControl = { skip: () => skipRef.current?.() };
    controlRef.current = control;
    return () => {
      if (controlRef.current === control) controlRef.current = null;
    };
  }, [controlRef]);
  useEffect(() => {
    callbacks.current = { onRevealed, onSettled };
  });

  const timers = useRef<number[]>([]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      skipRef.current = null;
      pending.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  useEffect(() => {
    if (!play || started.current) return;
    started.current = true;
    const later = (ms: number, run: () => void) => timers.current.push(window.setTimeout(run, ms));
    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      skipRef.current = null;
      setLanded(true);
      if (sound) {
        stopSound("revealCharge", 80);
        void playSound(REVEAL_SOUND[rarity]);
      }
      if (haptics) haptic(tier >= 3 ? "jackpot" : "success");
      callbacks.current.onRevealed?.();
      const el = ref.current;
      if (!reduced && el && tier > 0) {
        setFlash((n) => n + 1);
        const colors = REVEAL_COLORS[rarity];
        burstConfetti(el, REVEAL_PARTICLES[tier], colors, 1 + tier * 0.25);
        const box = el.getBoundingClientRect();
        const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        pixelSparks(middle, colors[0], 8 + tier * 3);
        if (tier >= 3)
          later(220, () => ref.current && burstConfetti(ref.current, REVEAL_PARTICLES[tier] / 2, colors, 1.6));
        if (tier >= 4) later(520, () => setFlash((n) => n + 1));
      }
      const count = valueCents !== undefined && !reduced ? REVEAL_COUNT_MS[tier] : 0;
      later(count + 1_800, () => {
        setSettled(true);
        callbacks.current.onSettled?.();
      });
    };
    if (instant) {
      later(0, land);
    } else {
      if (sound) void playSound("revealCharge", 1, { rate: Math.min(2, Math.max(0.75, 1450 / charge)) });
      if (haptics) haptic("tap");
      later(charge / 2, () => haptics && haptic("tap"));
      later(charge, land);
      skipRef.current = land;
    }
    // The sequence starts once, when `play` turns true; the rest is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  const roll = useRollUp(valueCents ?? 0, {
    run: phase === "revealed" && valueCents !== undefined,
    ms: REVEAL_COUNT_MS[tier],
    sound,
    delayMs: DURATION.slow * 1000,
  });
  const shown = roll.value;
  const seconds = charge / 1000;
  const glowInset = -width * (0.4 + tier * 0.06);
  const charging = phase === "charging";
  const revealed = phase === "revealed";
  const amplitude = Math.max(2, width * (0.012 + tier * 0.006));

  return (
    <div
      ref={ref}
      className={cn("relative", className)}
      style={{ width, height }}
      data-testid={testId}
      data-phase={phase}
      data-tier={tier}
      data-rarity={rarity}
    >
      {/* The glow: a faint leak while veiled, rising while charging, full once turned. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute"
        style={{ inset: glowInset }}
        initial={false}
        animate={
          revealed
            ? { opacity: 1, scale: 1 }
            : charging
              ? { opacity: [0.35, 1], scale: [0.7, 1.12 + tier * 0.04] }
              : { opacity: 0.25 + tier * 0.08, scale: 0.72 }
        }
        transition={
          charging ? { duration: seconds, ease: EASE.in } : { duration: reduced ? 0 : DURATION.slower, ease: EASE.out }
        }
      >
        <div
          className={cn(
            "nexamon-glow-pulse absolute inset-0",
            `nexamon-glow-${rarity}`,
            SPIN.has(rarity) && "nexamon-spin",
          )}
        />
        {tier >= 2 && phase !== "veiled" && <div className="nexamon-rays nexamon-spin absolute inset-0 opacity-70" />}
      </motion.div>

      {/* The card: shakes during the charge, then turns over (scaleX), the face lands with a bounce. */}
      <motion.div
        className="relative size-full"
        initial={false}
        animate={
          charging && !reduced
            ? {
                x: shakeFrames(amplitude, 18 + tier * 6),
                rotate: shakeFrames(1 + tier * 0.6, 12 + tier * 4),
                scale: [1, 1.03 + tier * 0.01],
              }
            : { x: 0, rotate: 0, scale: 1 }
        }
        transition={charging ? { duration: seconds, ease: "linear" } : { duration: DURATION.fast, ease: EASE.out }}
      >
        <motion.div
          className="absolute inset-0"
          initial={false}
          animate={revealed ? { scaleX: 0, opacity: 0 } : { scaleX: 1, opacity: 1 }}
          transition={{ duration: reduced ? 0 : DURATION.fast, ease: EASE.in }}
          aria-hidden={revealed}
          data-testid={`${testId}-back`}
        >
          {back}
        </motion.div>
        <motion.div
          className="relative"
          initial={false}
          animate={revealed ? { scaleX: 1, scale: 1, opacity: 1 } : { scaleX: 0, scale: 1.08, opacity: 0 }}
          transition={
            revealed ? (reduced ? { duration: 0 } : { ...SPRING.bouncy, delay: DURATION.fast }) : { duration: 0 }
          }
          aria-hidden={!revealed}
          data-testid={`${testId}-front`}
        >
          {front}
        </motion.div>
      </motion.div>

      {/* A white core over the card at the turn. */}
      {revealed && !reduced && tier > 0 && (
        <motion.div
          key={`core-${flash}`}
          aria-hidden
          className="nexamon-burst pointer-events-none absolute"
          style={{ inset: -width * 0.3 }}
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: [0, 1, 0], scale: [0.4, 1.2, 1.5] }}
          transition={{ duration: DURATION.slower * 1.6, ease: EASE.out, delay: DURATION.fast }}
        />
      )}

      {/* The screen flash: on the body, so no transformed parent pins it to the card. */}
      <ScreenFlash
        flashKey={flash}
        glow={`nexamon-glow-${rarity}`}
        strength={0.55 + tier * 0.1}
        seconds={DURATION.slower * (1.2 + tier * 0.3)}
        testId={`${testId}-flash`}
      />

      {/* The banner: the size of the hit, then the rarity. */}
      <AnimatePresence>
        {banner && revealed && tier > 0 && !settled && (
          <motion.div
            key="banner"
            className="pointer-events-none absolute inset-x-[-14%] top-[34%] z-10 flex flex-col items-center"
            initial={reduced ? false : { opacity: 0, scale: 0.4, rotate: -14 }}
            animate={{ opacity: 1, scale: 1, rotate: -6 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: DURATION.slow, ease: EASE.in } }}
            transition={reduced ? { duration: 0 } : { ...SPRING.bouncy, delay: DURATION.slow }}
            data-testid={`${testId}-banner`}
          >
            <span
              className={cn(
                "rounded-xs border-2 bg-surface-1 px-2 py-1 font-pixel uppercase shadow-3",
                tier >= 4 ? "border-gold text-gold" : tier >= 3 ? "border-gold text-fg-1" : "border-accent text-fg-1",
                width >= 200 ? "text-lg" : "text-sm",
              )}
            >
              {t(`tier${tier as 1 | 2 | 3 | 4}`)}
            </span>
            <span className="mt-1 rounded-xs bg-surface-1 px-1.5 py-0.5 label-pixel text-fg-2 shadow-2">
              {tr(`rarity.${rarity}`)}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The value rolls up under the card. */}
      {valueCents !== undefined && revealed && (
        <motion.div
          className="pointer-events-none absolute inset-x-0 -bottom-3 z-10 flex justify-center"
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION.slow, ease: EASE.out, delay: reduced ? 0 : DURATION.fast }}
        >
          <motion.span
            className={cn(
              "rounded-sm border-2 bg-surface-1 px-2 py-0.5 nums text-sm font-semibold shadow-2",
              tier >= 3 ? "border-gold text-gold" : "border-line-2 text-fg-1",
            )}
            animate={settled || reduced ? { scale: 1 } : roll.done ? { scale: [1, 1.18, 1] } : undefined}
            transition={{ duration: DURATION.slow, ease: EASE.out }}
            data-testid={`${testId}-value`}
            aria-label={t("value", { value: formatMoney(valueCents) })}
          >
            {formatMoney(shown)}
          </motion.span>
        </motion.div>
      )}
      <span className="sr-only" aria-live="polite">
        {revealed ? t("announce", { rarity: tr(`rarity.${rarity}`) }) : charging ? t("charging") : ""}
      </span>
    </div>
  );
}
