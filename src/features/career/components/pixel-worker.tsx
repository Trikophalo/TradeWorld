"use client";

import { motion, useReducedMotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { avatarArt } from "@/components/pixel/avatars";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";

/** Desk with a monitor, 24×12; the screen lines change while the figure works. */
const desk = (frame: number): PixelArt => ({
  palette: { k: "#232634", m: "#3a4157", s: "#62e0ff", d: "#8a6a4a", e: "#6b4f35", c: "#2fd98c" },
  grid: [
    "........kkkkkkkkkk......",
    "........kmmmmmmmmk......",
    `........km${frame % 2 ? "ssss.." : "sss..."}mk......`.slice(0, 24),
    `........km${frame % 3 ? "cc..ss" : "ss.cc."}mk......`.slice(0, 24),
    `........km${frame % 2 ? "s.sss." : "ssss.s"}mk......`.slice(0, 24),
    "........kmmmmmmmmk......",
    "........kkkkkkkkkk......",
    "............kk..........",
    "dddddddddddddddddddddddd",
    "eeeeeeeeeeeeeeeeeeeeeeee",
    ".ee..................ee.",
    ".ee..................ee.",
  ],
});

/**
 * The player's portrait at a desk, working (ADR-064). Only a symbol: work happens
 * automatically. Static with reduced motion.
 */
export function PixelWorker({ avatarKey, scale = 4 }: { avatarKey: string | null; scale?: 3 | 4 | 5 }) {
  const reduced = useReducedMotionConfig();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => setFrame((f) => f + 1), 420);
    return () => window.clearInterval(timer);
  }, [reduced]);

  return (
    <div className="relative mx-auto w-fit" aria-hidden>
      <motion.div
        animate={reduced ? undefined : { y: [0, -scale, 0] }}
        transition={{ duration: 0.84, repeat: Infinity, ease: "linear", times: [0, 0.5, 1] }}
        className="relative z-0 ml-[calc(var(--s)*1px)]"
        style={{ ["--s" as string]: 2 * scale }}
      >
        <PixelIcon {...avatarArt(avatarKey)} scale={scale} />
      </motion.div>
      <div className="relative z-10 -mt-[calc(var(--s)*1px)]" style={{ ["--s" as string]: 6 * scale }}>
        <PixelIcon {...desk(frame)} scale={scale} />
      </div>
      {!reduced && (
        <motion.span
          key={Math.floor(frame / 6)}
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: [0, 1, 0], y: -18 * scale }}
          transition={{ duration: 2.4, ease: "easeOut" }}
          className="absolute top-0 right-0 font-pixel text-xs text-gold"
        >
          +NX
        </motion.span>
      )}
    </div>
  );
}
