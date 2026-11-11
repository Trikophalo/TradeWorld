"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { isDisclosed, type DisclosureKey } from "@/config/disclosure";
import { usePlayerLevel } from "@/features/game/store";
import { DURATION, EASE } from "@/lib/motion";

/** True once the player's level has reached the disclosure level of `feature`. */
export function useDisclosed(feature: DisclosureKey): boolean {
  return isDisclosed(feature, usePlayerLevel());
}

/**
 * Renders its children only once the player has reached the level at which
 * `feature` is disclosed. Newly revealed parts fade and rise in.
 */
export function Reveal({ feature, children }: { feature: DisclosureKey; children: ReactNode }) {
  const visible = useDisclosed(feature);
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION.slower, ease: EASE.out }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
