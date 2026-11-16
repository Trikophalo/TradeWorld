"use client";

import { motion, useMotionValue, useReducedMotionConfig, useSpring, useTransform } from "motion/react";
import { useTranslations } from "next-intl";
import { memo, type PointerEvent } from "react";
import type { NexamonSetKey } from "@/config/nexamon";
import { composePack, PACK_SIZE } from "@/components/pixel/nexamon-pack";
import { cn } from "@/lib/utils";
import { pixelScale } from "../lib";
import { PixelCanvas } from "./pixel-canvas";
import "./nexamon.css";

/** The band of light that runs over the foil of a pack every few seconds. */
export function PackSheen({ scale }: { scale: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute overflow-hidden"
      style={{ inset: scale, mixBlendMode: "overlay" }}
    >
      <div className="nexamon-pack-sheen nexamon-sheen-bar absolute inset-y-0 left-0 w-1/5 opacity-90" />
      <div className="nexamon-pack-sheen nexamon-sheen-bar absolute inset-y-0 left-0 w-1/6 opacity-60 [animation-delay:0.5s]" />
    </div>
  );
}

/** Aluminium foil: still streaks of light and shade across the pack, so the print looks like metal. */
export function PackFoil({ scale }: { scale: number }) {
  return <div aria-hidden className="nexamon-foil-metal pointer-events-none absolute" style={{ inset: scale }} />;
}

export interface NexamonPackProps {
  set: NexamonSetKey;
  /** CSS pixels per art pixel. A pack is 76 x 112 art pixels. */
  scale?: number;
  /** The moving band of light on the foil. */
  sheen?: boolean;
  className?: string;
}

/** A sealed booster pack of a set, as pixel art with a foil sheen. */
export const NexamonPack = memo(function NexamonPack({ set, scale = 3, sheen = true, className }: NexamonPackProps) {
  const t = useTranslations("nexamonCards");
  const u = pixelScale(scale);
  return (
    <div
      role="img"
      aria-label={t("pack.label", { set: t(`sets.${set}`) })}
      data-set={set}
      className={cn("relative isolate shrink-0 select-none", className)}
      style={{ width: PACK_SIZE.width * u, height: PACK_SIZE.height * u }}
    >
      <PixelCanvas raster={composePack(set).full} scale={u} />
      <PackFoil scale={u} />
      {sheen && <PackSheen scale={u} />}
    </div>
  );
});

const TILT_SPRING = { stiffness: 260, damping: 22, mass: 0.6 } as const;
const MAX_TILT = 14;

/**
 * A pack that leans towards the pointer in 3D, with a spot of light that follows it: for shelves where the pack
 * is the thing to pick. With reduced motion it stays flat.
 */
export function TiltPack({ set, scale = 3, className }: Omit<NexamonPackProps, "sheen">) {
  const reduced = useReducedMotionConfig() ?? false;
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const x = useSpring(px, TILT_SPRING);
  const y = useSpring(py, TILT_SPRING);
  const rotateX = useTransform(y, [0, 1], [MAX_TILT, -MAX_TILT]);
  const rotateY = useTransform(x, [0, 1], [-MAX_TILT, MAX_TILT]);
  const glareX = useTransform(x, [0, 1], ["-35%", "35%"]);
  const glareY = useTransform(y, [0, 1], ["-35%", "35%"]);
  const lift = useSpring(1, TILT_SPRING);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (reduced) return;
    const rect = event.currentTarget.getBoundingClientRect();
    px.set(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
    py.set(Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)));
    lift.set(1.04);
  };
  const rest = () => {
    px.set(0.5);
    py.set(0.5);
    lift.set(1);
  };
  return (
    <div
      className={cn("inline-block shrink-0 [perspective:700px]", className)}
      onPointerMove={move}
      onPointerLeave={rest}
      onPointerCancel={rest}
      onPointerUp={(event) => {
        if (event.pointerType !== "mouse") rest();
      }}
      data-testid="tilt-pack"
    >
      <motion.div
        className="relative"
        style={{
          rotateX: reduced ? 0 : rotateX,
          rotateY: reduced ? 0 : rotateY,
          scale: lift,
          transformStyle: "preserve-3d",
        }}
      >
        <NexamonPack set={set} scale={scale} />
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden mix-blend-soft-light">
          <motion.div className="nexamon-pack-glare absolute -inset-1/4" style={{ x: glareX, y: glareY }} />
        </div>
      </motion.div>
    </div>
  );
}
