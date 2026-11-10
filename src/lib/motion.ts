/**
 * Motion tokens for the Motion library. They mirror the CSS tokens in
 * src/styles/tokens.css; keep both in sync.
 */
import type { Transition } from "motion/react";

export const DURATION = {
  instant: 0.08,
  fast: 0.15,
  base: 0.2,
  slow: 0.3,
  slower: 0.45,
} as const;

export const EASE = {
  standard: [0.2, 0, 0, 1],
  out: [0.16, 1, 0.3, 1],
  in: [0.5, 0, 0.9, 0.3],
  inOut: [0.65, 0, 0.35, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** Springs for anything that should feel physical. */
export const SPRING = {
  /** Tab indicators, toggles, small things that snap. */
  snappy: { type: "spring", stiffness: 520, damping: 38, mass: 0.8 },
  /** Cards, sheets, layout changes. */
  smooth: { type: "spring", stiffness: 300, damping: 32 },
  /** Celebrations: allowed to overshoot. */
  bouncy: { type: "spring", stiffness: 420, damping: 16 },
} as const satisfies Record<string, Transition>;

export const STAGGER = 0.04;

export const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE.out } },
} as const;

export const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: STAGGER } },
} as const;
