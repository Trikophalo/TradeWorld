"use client";

import { motion, useReducedMotionConfig } from "motion/react";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** The pointed tail under the bubble, in the bubble's own colours. */
const TAIL: PixelArt = {
  palette: { k: "var(--line-2)", w: "var(--surface-1)" },
  grid: ["kwwwwk", ".kwwk.", "..kk.."],
};

/**
 * A pixel speech bubble over a figure on the company floor (ADR-156): hard 2 px border, square corners, a stepped tail
 * pointing down at the speaker. Pops up with opacity and scale only; static with reduced motion.
 */
export function FloorBubble({ text, mine, className }: { text: string; mine?: boolean; className?: string }) {
  const reduced = useReducedMotionConfig();
  return (
    <motion.span
      initial={reduced ? false : { opacity: 0, scale: 0.85, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
      transition={{ duration: DURATION.base, ease: EASE.out }}
      className={cn("relative flex origin-bottom flex-col items-center", className)}
      data-testid="floor-bubble"
    >
      <span
        className={cn(
          "block w-full rounded-xs border-2 border-line-2 bg-surface-1 px-1.5 py-1 text-center text-2xs leading-snug text-pretty break-words text-fg-1 shadow-1 sm:text-xs",
          mine && "border-accent",
        )}
      >
        {text}
      </span>
      <PixelIcon
        {...(mine ? { ...TAIL, palette: { ...TAIL.palette, k: "var(--accent)" } } : TAIL)}
        scale={2}
        className="-mt-0.5"
      />
    </motion.span>
  );
}
