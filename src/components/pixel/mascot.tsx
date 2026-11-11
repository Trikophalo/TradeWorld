"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { FINN, type FinnMood } from "./art";
import { PixelIcon } from "./pixel-icon";

export interface MascotProps {
  /** `talk` flaps the mouth, `happy` shows the celebration face. */
  mood?: "idle" | "talk" | "happy";
  /** Pixel scale: 3 = 48px, 4 = 64px, 6 = 96px. */
  scale?: number;
  className?: string;
}

/**
 * Finn the fox. He bobs gently, blinks now and then and moves his mouth
 * while he speaks. All motion is frame swapping plus `transform`.
 */
export function Mascot({ mood = "idle", scale = 4, className }: MascotProps) {
  const [frame, setFrame] = useState<FinnMood>("idle");

  useEffect(() => {
    if (mood === "happy") return;
    if (mood === "talk") {
      let open = false;
      const timer = window.setInterval(() => {
        open = !open;
        setFrame(open ? "talk" : "idle");
      }, 130);
      return () => {
        window.clearInterval(timer);
        setFrame("idle");
      };
    }
    // Idle: blink at irregular intervals.
    let timeout: number;
    const schedule = () => {
      timeout = window.setTimeout(
        () => {
          setFrame("blink");
          timeout = window.setTimeout(() => {
            setFrame("idle");
            schedule();
          }, 140);
        },
        2200 + Math.random() * 2600,
      );
    };
    schedule();
    return () => window.clearTimeout(timeout);
  }, [mood]);

  return (
    <motion.div
      className={className}
      animate={mood === "happy" ? { y: [0, -10, 0, -5, 0] } : { y: [0, -3, 0] }}
      transition={
        mood === "happy" ? { duration: 0.7, ease: "easeOut" } : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
      }
    >
      <PixelIcon {...FINN[mood === "happy" ? "happy" : frame]} scale={scale} title="Finn" />
    </motion.div>
  );
}
