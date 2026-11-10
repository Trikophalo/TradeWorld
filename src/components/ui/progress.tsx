"use client";

import { motion } from "motion/react";
import { SPRING } from "@/lib/motion";
import { clamp, cn } from "@/lib/utils";

export interface ProgressProps {
  /** 0 to 1 */
  value: number;
  label: string;
  tone?: "accent" | "gain" | "warn" | "gold";
  size?: "sm" | "md";
  className?: string;
}

const TONES = { accent: "bg-accent", gain: "bg-gain", warn: "bg-warn", gold: "bg-gold" } as const;

/** The fill scales on the X axis, so it animates on the compositor. */
export function Progress({ value, label, tone = "accent", size = "md", className }: ProgressProps) {
  const ratio = clamp(value, 0, 1);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      className={cn("overflow-hidden rounded-xs bg-surface-3", size === "sm" ? "h-1.5" : "h-2.5", className)}
    >
      <motion.div
        className={cn("h-full w-full origin-left", TONES[tone])}
        initial={false}
        animate={{ scaleX: ratio }}
        transition={SPRING.smooth}
      />
    </div>
  );
}
