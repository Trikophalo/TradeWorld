"use client";

import { motion, useMotionValue, useReducedMotionConfig, useSpring, useTransform } from "motion/react";
import { useEffect, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import type { CardLight } from "./holo";

export type CardSide = "front" | "back";

export interface TiltFlipProps {
  /** Size of both sides in CSS pixels. */
  width: number;
  height: number;
  /** The front gets the light of the tilt for its foil. */
  front: (light: CardLight) => ReactNode;
  back: ReactNode;
  /** Controlled side. Leave it out and the component keeps the side itself, starting with `defaultSide`. */
  side?: CardSide;
  defaultSide?: CardSide;
  onSideChange?: (side: CardSide) => void;
  /** Lean towards the pointer (off for cards inside something that moves itself). */
  tilt?: boolean;
  /** Click, tap, Enter, Space and F turn the card around. */
  flippable?: boolean;
  /** Largest lean in degrees. */
  maxTilt?: number;
  /** Accessible name of the control. */
  label: string;
  className?: string;
  testId?: string;
}

const TILT_SPRING = { stiffness: 220, damping: 22 } as const;

/**
 * Two sides that turn around their vertical axis and lean towards the pointer, the way the business card does
 * (ADR-054): the pointer position becomes two springs, which drive the lean and, through `light`, the foil.
 * With reduced motion nothing leans or turns; the sides cross-fade.
 */
export function TiltFlip({
  width,
  height,
  front,
  back,
  side: controlled,
  defaultSide = "front",
  onSideChange,
  tilt = true,
  flippable = true,
  maxTilt = 11,
  label,
  className,
  testId,
}: TiltFlipProps) {
  const reduced = useReducedMotionConfig();
  const [own, setOwn] = useState<CardSide>(defaultSide);
  const side = controlled ?? own;

  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const lightX = useSpring(px, TILT_SPRING);
  const lightY = useSpring(py, TILT_SPRING);
  const turn = useSpring(side === "back" ? 180 : 0, SPRING.smooth);
  const rotateX = useTransform(lightY, [0, 1], [maxTilt, -maxTilt]);
  const rotateY = useTransform(() => (lightX.get() - 0.5) * 2 * maxTilt + turn.get());
  useEffect(() => {
    turn.set(side === "back" ? 180 : 0);
  }, [side, turn]);

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (reduced || !tilt) return;
    const rect = event.currentTarget.getBoundingClientRect();
    px.set(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
    py.set(Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)));
  };
  const rest = () => {
    px.set(0.5);
    py.set(0.5);
  };
  const flip = () => {
    if (!flippable) return;
    const next: CardSide = side === "front" ? "back" : "front";
    setOwn(next);
    onSideChange?.(next);
    playSound("tap");
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "f" && event.key !== "F") return;
    event.preventDefault();
    flip();
  };

  const light: CardLight = { x: lightX, y: lightY };
  const shared = {
    role: flippable ? ("button" as const) : undefined,
    tabIndex: flippable ? 0 : undefined,
    "aria-label": label,
    "aria-pressed": flippable ? side === "back" : undefined,
    "data-face": side,
    "data-testid": testId,
    onClick: flip,
    onKeyDown: flippable ? key : undefined,
  };

  // One tree for both modes, so the server render and a client that prefers reduced motion agree. Everything
  // that differs is a motion style, which Motion applies itself after mounting.
  const fade = { duration: DURATION.base, ease: EASE.standard };
  return (
    <div className={cn("inline-block shrink-0 [perspective:900px]", className)} style={{ width, height }}>
      <motion.div
        {...shared}
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={rest}
        onPointerUp={(event) => {
          if (event.pointerType !== "mouse") rest();
        }}
        onPointerCancel={rest}
        style={{ rotateX: reduced ? 0 : rotateX, rotateY: reduced ? 0 : rotateY, transformStyle: "preserve-3d" }}
        className={cn("relative size-full rounded-sm focus-ring", flippable && "cursor-pointer")}
      >
        <motion.div
          initial={false}
          animate={{ opacity: reduced && side === "back" ? 0 : 1 }}
          transition={fade}
          className="absolute inset-0 [backface-visibility:hidden]"
          aria-hidden={side !== "front"}
        >
          {front(light)}
        </motion.div>
        <motion.div
          initial={false}
          animate={{ opacity: reduced && side === "front" ? 0 : 1 }}
          transition={fade}
          style={{ rotateY: reduced ? 0 : 180 }}
          className="absolute inset-0 [backface-visibility:hidden]"
          aria-hidden={side !== "back"}
        >
          {back}
        </motion.div>
      </motion.div>
    </div>
  );
}
