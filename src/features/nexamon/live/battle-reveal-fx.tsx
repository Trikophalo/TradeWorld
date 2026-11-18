"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { NexamonRarity } from "@/config/nexamon";
import { formatMoney } from "@/lib/format";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { REVEAL_GLOW, revealCountCents, type BattleRevealTier } from "./battle-reveal";

const COUNT_MS = 700;
const BURST = 10;

/**
 * ADR-205: the reveal of one of the last two cards of a pack in a Pack Battle, around the card it wraps. Escalates
 * with `tier` (battleRevealTier): a glow, then a flash, a shake of the card and a burst of pixel sparks; a value
 * counter counts the card's value up beneath it. Only transform and opacity move; with reduced motion only the glow
 * fades in and the counter shows the value at once. Mount it with a new `key` per reveal.
 */
export function BattleRevealFx({
  tier,
  rarity,
  valueCents,
  reduced,
  children,
  className,
}: {
  tier: BattleRevealTier;
  rarity: NexamonRarity;
  valueCents: number;
  reduced: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const shown = useCountUp(valueCents, reduced || tier === 0 ? 0 : COUNT_MS);
  if (tier === 0) return <div className={cn("relative", className)}>{children}</div>;
  const glow = REVEAL_GLOW[rarity];
  return (
    <div className={cn("relative", className)} data-testid="battle-reveal-fx" data-tier={tier} data-rarity={rarity}>
      {/* glow behind the card, stronger and pulsing from the shake tier on */}
      <motion.span
        aria-hidden
        className={cn("pointer-events-none absolute -inset-4 rounded-xl blur-xl", glow)}
        initial={{ opacity: 0, scale: reduced ? 1 : 0.6 }}
        animate={
          reduced
            ? { opacity: 0.35 }
            : tier >= 3
              ? { opacity: [0, 0.9, 0.5, 0.8, 0.55], scale: [0.6, 1.15, 1, 1.08, 1] }
              : { opacity: [0, 0.7, 0.4], scale: [0.6, 1.05, 1] }
        }
        transition={{ duration: reduced ? DURATION.slow : 1.2, ease: EASE.out }}
      />
      <motion.div
        className="relative"
        animate={
          !reduced && tier >= 3 ? { x: [0, -6, 6, -5, 5, -3, 3, 0], rotate: [0, -2, 2, -1.5, 1.5, 0] } : undefined
        }
        transition={{ duration: 0.6, ease: EASE.out, delay: 0.1 }}
      >
        {children}
      </motion.div>
      {/* flash over the card */}
      {tier >= 2 && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-md bg-shine"
          initial={{ opacity: 0 }}
          animate={{ opacity: reduced ? [0, 0.2, 0] : [0, 0.85, 0] }}
          transition={{ duration: 0.5, ease: EASE.out }}
        />
      )}
      {/* burst of pixel sparks */}
      {tier >= 4 && !reduced && (
        <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          {Array.from({ length: BURST }, (_, i) => {
            const angle = (Math.PI * 2 * i) / BURST;
            const dist = 70 + (i % 3) * 18;
            return (
              <motion.span
                key={i}
                className={cn("absolute size-2", i % 2 === 0 ? glow : "bg-gold")}
                initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                animate={{ opacity: 0, x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, scale: 0.4 }}
                transition={{ duration: 0.9, ease: EASE.out, delay: 0.05 }}
              />
            );
          })}
        </span>
      )}
      <motion.span
        className="absolute -bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-pill border-2 border-line-2 bg-surface-1 px-2 py-0.5 nums text-xs font-semibold whitespace-nowrap text-fg-1 shadow-2"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.8 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={reduced ? { duration: DURATION.fast } : SPRING.bouncy}
        data-testid="battle-reveal-value"
        data-cents={valueCents}
      >
        +{formatMoney(shown)}
      </motion.span>
    </div>
  );
}

/** Counts from 0 up to `cents` over `durationMs` after mount (0 ms: the value at once). */
function useCountUp(cents: number, durationMs: number): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (durationMs <= 0) return;
    let frame = 0;
    const start = performance.now();
    const step = () => {
      const elapsed = performance.now() - start;
      setValue(revealCountCents(cents, elapsed, durationMs));
      if (elapsed < durationMs) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [cents, durationMs]);
  return durationMs > 0 ? value : cents;
}
