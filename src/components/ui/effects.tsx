"use client";

import { AnimatePresence, motion } from "motion/react";
import { create } from "zustand";
import { COIN } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { EASE } from "@/lib/motion";
import { prefersReducedMotion } from "@/stores/settings";

interface Point {
  x: number;
  y: number;
}

interface Particle {
  id: number;
  kind: "coin" | "confetti";
  from: Point;
  to: Point;
  delay: number;
  color?: string;
  rotate?: number;
}

interface EffectsState {
  particles: Particle[];
  add: (particles: Particle[]) => void;
  remove: (id: number) => void;
}

const useEffects = create<EffectsState>((set) => ({
  particles: [],
  add: (particles) => set((state) => ({ particles: [...state.particles, ...particles] })),
  remove: (id) => set((state) => ({ particles: state.particles.filter((p) => p.id !== id) })),
}));

let nextId = 1;
const center = (rect: DOMRect): Point => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

/** Pixel coins fly from one element to another (vault -> cash balance). */
export function flyCoins(from: Element, to: Element | null, count = 8): void {
  if (prefersReducedMotion() || !to) return;
  const start = center(from.getBoundingClientRect());
  const end = center(to.getBoundingClientRect());
  useEffects.getState().add(
    Array.from({ length: count }, (_, i) => ({
      id: nextId++,
      kind: "coin" as const,
      from: { x: start.x + (Math.random() - 0.5) * 48, y: start.y + (Math.random() - 0.5) * 24 },
      to: end,
      delay: i * 0.05,
    })),
  );
}

const CONFETTI_COLORS = ["var(--gain)", "var(--gold)", "var(--accent)", "var(--info)", "var(--fg-1)"];

/** A burst of square pixel confetti from an element. */
export function burstConfetti(from: Element, count = 28): void {
  if (prefersReducedMotion()) return;
  const start = center(from.getBoundingClientRect());
  useEffects.getState().add(
    Array.from({ length: count }, (_, i) => {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const distance = 70 + Math.random() * 110;
      return {
        id: nextId++,
        kind: "confetti" as const,
        from: start,
        to: { x: start.x + Math.cos(angle) * distance, y: start.y + Math.sin(angle) * distance + 60 },
        delay: Math.random() * 0.05,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rotate: Math.round(Math.random() * 4) * 90,
      };
    }),
  );
}

/** Fixed, click-through layer that renders flying particles. Mounted once in the root layout. */
export function EffectsLayer() {
  const particles = useEffects((state) => state.particles);
  const remove = useEffects((state) => state.remove);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-celebration overflow-hidden">
      <AnimatePresence>
        {particles.map((particle) =>
          particle.kind === "coin" ? (
            <motion.div
              key={particle.id}
              className="absolute top-0 left-0 -mt-4 -ml-4"
              initial={{ x: particle.from.x, y: particle.from.y, scale: 0, opacity: 0 }}
              animate={{
                x: [particle.from.x, particle.from.x, particle.to.x],
                y: [particle.from.y, particle.from.y - 36, particle.to.y],
                scale: [0, 1, 0.5],
                opacity: [0, 1, 1],
              }}
              transition={{ duration: 0.8, delay: particle.delay, times: [0, 0.3, 1], ease: EASE.inOut }}
              onAnimationComplete={() => remove(particle.id)}
            >
              <PixelIcon {...COIN} scale={2} />
            </motion.div>
          ) : (
            <motion.div
              key={particle.id}
              className="absolute top-0 left-0 size-2"
              style={{ backgroundColor: particle.color }}
              initial={{ x: particle.from.x, y: particle.from.y, scale: 0, opacity: 1, rotate: 0 }}
              animate={{
                x: particle.to.x,
                y: particle.to.y,
                scale: [0, 1.4, 1],
                opacity: [1, 1, 0],
                rotate: particle.rotate,
              }}
              transition={{ duration: 0.9, delay: particle.delay, ease: EASE.out }}
              onAnimationComplete={() => remove(particle.id)}
            />
          ),
        )}
      </AnimatePresence>
    </div>
  );
}
