"use client";

import { motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import type { CSSProperties } from "react";
import type { NexamonRarity } from "@/config/nexamon/types";
import { FACE_LAYOUT, type Box } from "@/components/pixel/nexamon-face";
import { cn } from "@/lib/utils";
import "./nexamon.css";

/** Where the light comes from, 0..1 across and down the card (0.5 / 0.5 is head-on). Driven by the tilt. */
export interface CardLight {
  x: MotionValue<number>;
  y: MotionValue<number>;
}

type Blend = CSSProperties["mixBlendMode"];

export interface FoilSpec {
  /** Gradient class from nexamon.css. */
  ink: string;
  blend: Blend;
  opacity: number;
  /** How far the layer travels with the light, in percent of its own size; negative runs against the light. */
  travel: number;
  /** Class of the idle drift, or of a twinkle. */
  idle?: string;
}

/** The foil recipe of each rarity, bottom layer first. Commons have none. */
const FOILS: Record<NexamonRarity, readonly FoilSpec[]> = {
  common: [],
  rare: [
    { ink: "nexamon-foil-rainbow", blend: "color-dodge", opacity: 0.16, travel: 16, idle: "nexamon-foil-idle" },
    { ink: "nexamon-foil-bands", blend: "overlay", opacity: 0.4, travel: 22, idle: "nexamon-foil-idle" },
    { ink: "nexamon-foil-glare", blend: "soft-light", opacity: 0.5, travel: -24 },
  ],
  ultra: [
    { ink: "nexamon-foil-rainbow", blend: "color-dodge", opacity: 0.17, travel: 18, idle: "nexamon-foil-idle" },
    { ink: "nexamon-foil-bands", blend: "overlay", opacity: 0.4, travel: 24, idle: "nexamon-foil-idle-b" },
    { ink: "nexamon-foil-glitter-b", blend: "screen", opacity: 0.55, travel: 6, idle: "nexamon-twinkle" },
    { ink: "nexamon-foil-glare", blend: "overlay", opacity: 0.5, travel: -26 },
  ],
  prisma: [
    { ink: "nexamon-foil-rainbow", blend: "color-dodge", opacity: 0.24, travel: 20, idle: "nexamon-foil-idle" },
    { ink: "nexamon-foil-rainbow-b", blend: "overlay", opacity: 0.26, travel: -16, idle: "nexamon-foil-idle-b" },
    { ink: "nexamon-foil-bands", blend: "overlay", opacity: 0.3, travel: 26, idle: "nexamon-foil-idle" },
    { ink: "nexamon-foil-glitter", blend: "screen", opacity: 0.6, travel: 8, idle: "nexamon-twinkle" },
    { ink: "nexamon-foil-glare", blend: "overlay", opacity: 0.55, travel: -26 },
  ],
  legendary: [
    { ink: "nexamon-foil-gold", blend: "color-dodge", opacity: 0.22, travel: 20, idle: "nexamon-foil-idle" },
    { ink: "nexamon-foil-bands", blend: "overlay", opacity: 0.45, travel: 28, idle: "nexamon-foil-idle-b" },
    { ink: "nexamon-foil-glitter", blend: "screen", opacity: 0.8, travel: 9, idle: "nexamon-twinkle" },
    { ink: "nexamon-foil-glitter-b", blend: "screen", opacity: 0.7, travel: -7, idle: "nexamon-twinkle-b" },
    { ink: "nexamon-foil-glare", blend: "overlay", opacity: 0.65, travel: -28 },
  ],
  // ADR-174: black-and-gold with an iridescent sheen that drifts three times slower than any other foil
  one_of_one: [
    { ink: "nexamon-foil-iris", blend: "color-dodge", opacity: 0.3, travel: 14, idle: "nexamon-foil-idle-slow" },
    { ink: "nexamon-foil-gold", blend: "overlay", opacity: 0.35, travel: -12, idle: "nexamon-foil-idle-slow" },
    { ink: "nexamon-foil-glitter", blend: "screen", opacity: 0.5, travel: 5, idle: "nexamon-twinkle-b" },
    { ink: "nexamon-foil-glare", blend: "soft-light", opacity: 0.6, travel: -18 },
  ],
  // ADR-182, Titans Revenge. Iron: no foil, just a few sparks that glint now and then
  iron: [{ ink: "nexamon-foil-sparks", blend: "screen", opacity: 0.55, travel: 4, idle: "nexamon-twinkle-b" }],
  // Titanium: cold brushed metal, fine streaks in silver-blue that slide with the light
  titanium: [
    { ink: "nexamon-foil-brushed", blend: "overlay", opacity: 0.5, travel: 22, idle: "nexamon-foil-idle" },
    { ink: "nexamon-foil-glare", blend: "soft-light", opacity: 0.55, travel: -24 },
  ],
  // Diamond: prismatic facets and a brilliant sparkle on top
  diamond: [
    { ink: "nexamon-foil-facets", blend: "color-dodge", opacity: 0.32, travel: 18, idle: "nexamon-foil-idle" },
    { ink: "nexamon-foil-rainbow-b", blend: "overlay", opacity: 0.28, travel: -14, idle: "nexamon-foil-idle-b" },
    { ink: "nexamon-foil-glitter", blend: "screen", opacity: 0.95, travel: 9, idle: "nexamon-twinkle" },
    { ink: "nexamon-foil-glitter-b", blend: "screen", opacity: 0.9, travel: -7, idle: "nexamon-twinkle-b" },
    { ink: "nexamon-foil-glare", blend: "overlay", opacity: 0.6, travel: -26 },
  ],
  // Uranium: a green glow that pulses from the edges
  uranium: [
    { ink: "nexamon-foil-uranium", blend: "screen", opacity: 0.7, travel: 6, idle: "nexamon-foil-pulse" },
    { ink: "nexamon-foil-glitter-b", blend: "screen", opacity: 0.45, travel: 5, idle: "nexamon-twinkle" },
    { ink: "nexamon-foil-glare", blend: "soft-light", opacity: 0.45, travel: -18 },
  ],
};

export function FoilLayer({ spec, light, still }: { spec: FoilSpec; light: CardLight; still: boolean }) {
  const x = useTransform(light.x, [0, 1], [`${spec.travel}%`, `${-spec.travel}%`]);
  const y = useTransform(light.y, [0, 1], [`${spec.travel * 0.6}%`, `${-spec.travel * 0.6}%`]);
  // The blend mode sits on the moving layer itself: it is the group that meets the card underneath.
  return (
    <motion.div
      className="nexamon-foil"
      style={{ x: still ? 0 : x, y: still ? 0 : y, mixBlendMode: spec.blend, opacity: spec.opacity }}
    >
      <div className={cn("absolute inset-0", !still && spec.idle, spec.ink)} />
    </motion.div>
  );
}

export interface HoloLayersProps {
  rarity: NexamonRarity;
  /** CSS pixels per art pixel. */
  scale: number;
  /** Light from the tilt of the card. Without it the foil only drifts by itself. */
  light?: CardLight;
  /** No movement at all (reduced motion, thumbnails). */
  still?: boolean;
}

/**
 * The foil of a card: gradient layers three times the size of their box that slide with the light and are
 * blended onto the print. A rare card has it in the art window, everything above over the whole card.
 */
export function HoloLayers({ rarity, scale, light, still = false }: HoloLayersProps) {
  const restX = useMotionValue(0.5);
  const restY = useMotionValue(0.5);
  const foils = FOILS[rarity];
  if (foils.length === 0) return null;
  const source = light ?? { x: restX, y: restY };
  const box: Box = rarity === "rare" ? FACE_LAYOUT.rare.window : { x: 0, y: 0, w: 72, h: 100 };
  return (
    <div
      aria-hidden
      className="nexamon-foil-box"
      style={
        {
          left: box.x * scale,
          top: box.y * scale,
          width: box.w * scale,
          height: box.h * scale,
          borderRadius: rarity === "rare" ? 0 : scale * 1.5,
          "--u": `${scale}px`,
        } as CSSProperties
      }
    >
      {foils.map((spec) => (
        <FoilLayer key={spec.ink} spec={spec} light={source} still={still} />
      ))}
    </div>
  );
}

/** One still layer of foil for thumbnails: enough to tell a foil card in a grid, at almost no cost. */
export function HoloHint({ rarity, scale }: { rarity: NexamonRarity; scale: number }) {
  if (rarity === "common") return null;
  const box: Box = rarity === "rare" ? FACE_LAYOUT.rare.window : { x: 1, y: 1, w: 70, h: 98 };
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute",
        rarity === "legendary" ? "nexamon-foil-gold" : "nexamon-foil-rainbow",
      )}
      style={{
        left: box.x * scale,
        top: box.y * scale,
        width: box.w * scale,
        height: box.h * scale,
        backgroundSize: "300% 300%",
        mixBlendMode: "color-dodge",
        opacity: rarity === "rare" ? 0.2 : 0.32,
      }}
    />
  );
}
