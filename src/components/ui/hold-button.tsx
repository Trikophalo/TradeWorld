"use client";

import { animate, motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { useRef, type ReactNode } from "react";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";

export interface HoldButtonProps {
  onConfirm: () => void;
  children: ReactNode;
  /** Seconds the button has to be held. */
  duration?: number;
  tone?: "gain" | "loss" | "accent";
  disabled?: boolean;
  className?: string;
}

const TONES = {
  gain: { base: "bg-gain-soft text-gain border-gain/40", fill: "bg-gain", done: "text-on-semantic" },
  loss: { base: "bg-loss-soft text-loss border-loss/40", fill: "bg-loss", done: "text-on-semantic" },
  accent: { base: "bg-accent-soft text-accent border-accent/40", fill: "bg-accent-strong", done: "text-on-accent" },
} as const;

/**
 * "Hold to buy": a deliberate confirmation for large or leveraged orders.
 * Works with pointer and with Space/Enter; releasing early rewinds the fill.
 */
export function HoldButton({
  onConfirm,
  children,
  duration = 0.9,
  tone = "gain",
  disabled,
  className,
}: HoldButtonProps) {
  const progress = useMotionValue(0);
  const controls = useRef<ReturnType<typeof animate> | null>(null);
  const holding = useRef(false);
  const styles = TONES[tone];

  const start = () => {
    if (disabled || holding.current) return;
    holding.current = true;
    haptic("tap");
    void playSound("tap");
    controls.current?.stop();
    controls.current = animate(progress, 1, {
      duration: duration * (1 - progress.get()),
      ease: "linear",
      onComplete: () => {
        holding.current = false;
        haptic("success");
        onConfirm();
        animate(progress, 0, { duration: 0.3, delay: 0.25 });
      },
    });
  };

  const cancel = () => {
    if (!holding.current) return;
    holding.current = false;
    controls.current?.stop();
    controls.current = animate(progress, 0, { duration: 0.2, ease: "easeOut" });
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) start();
      }}
      onKeyUp={cancel}
      onBlur={cancel}
      onContextMenu={(event) => event.preventDefault()}
      className={cn(
        "relative h-13 w-full touch-none overflow-hidden rounded-md border font-pixel text-sm uppercase focus-ring select-none",
        "transition duration-fast ease-standard active:scale-[0.98] disabled:opacity-40",
        styles.base,
        className,
      )}
    >
      <motion.span
        aria-hidden
        className={cn("absolute inset-0 origin-left", styles.fill)}
        style={{ scaleX: progress }}
      />
      {/* Two copies of the label: the upper one is revealed by the fill. */}
      <span className="relative">{children}</span>
      <motion.span
        aria-hidden
        className={cn("absolute inset-0 grid place-items-center", styles.done)}
        style={{ clipPath: useClip(progress) }}
      >
        {children}
      </motion.span>
    </button>
  );
}

function useClip(progress: MotionValue<number>) {
  return useTransform(progress, (value) => `inset(0 ${100 - value * 100}% 0 0)`);
}
