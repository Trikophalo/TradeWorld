"use client";

import { animate } from "motion/react";
import { useEffect, useRef } from "react";
import { DURATION, EASE } from "@/lib/motion";
import { prefersReducedMotion } from "@/stores/settings";
import { cn } from "@/lib/utils";

export interface NumberTickerProps {
  value: number;
  /** Turns the animated number into text, e.g. `(v) => formatMoney(Math.round(v))`. */
  format: (value: number) => string;
  /** Briefly tint the value green or red when it changes. */
  flash?: boolean;
  className?: string;
}

/**
 * Counts from the previous value to the new one. The text is written
 * straight to the DOM node, so a price tick never re-renders React.
 */
export function NumberTicker({ value, format, flash = false, className }: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  const formatRef = useRef(format);

  useEffect(() => {
    formatRef.current = format;
  });

  useEffect(() => {
    const node = ref.current;
    const from = previous.current;
    previous.current = value;
    if (!node || from === value) return;

    if (flash) {
      const name = value > from ? "animate-flash-gain" : "animate-flash-loss";
      node.classList.remove("animate-flash-gain", "animate-flash-loss");
      void node.offsetWidth; // restart the CSS animation
      node.classList.add(name);
    }

    if (prefersReducedMotion()) {
      node.textContent = formatRef.current(value);
      return;
    }
    const controls = animate(from, value, {
      duration: DURATION.slower,
      ease: EASE.out,
      onUpdate: (latest) => {
        node.textContent = formatRef.current(latest);
      },
    });
    return () => controls.stop();
  }, [value, flash]);

  return (
    <span ref={ref} className={cn("inline-block rounded-xs nums", className)}>
      {format(value)}
    </span>
  );
}
