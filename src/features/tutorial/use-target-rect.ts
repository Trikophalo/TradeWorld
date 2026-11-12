"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "@/stores/settings";

export interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function findVisible(target: string): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`);
  for (const element of candidates) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return element;
  }
  // On phones some tabs live in the "Mehr" sheet (ADR-082): point there instead.
  return target.startsWith("nav-") && target !== "nav-more" ? findVisible("nav-more") : null;
}

/**
 * Follows the on-screen position of the first visible element with the given
 * `data-tour` value. The same control can exist twice (tab bar and sidebar);
 * only one of them is visible at a time. Returns null while it is not on the page.
 */
export function useTargetRect(target: string | undefined): TargetRect | null {
  const [rect, setRect] = useState<TargetRect | null>(null);

  useEffect(() => {
    if (!target) return;
    let frame = 0;
    let scrolled: HTMLElement | null = null;
    let last = "";

    const measure = () => {
      const element = findVisible(target);
      if (element && element !== scrolled) {
        scrolled = element;
        element.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      }
      const box = element?.getBoundingClientRect();
      const next = box ? { top: box.top, left: box.left, width: box.width, height: box.height } : null;
      const key = next
        ? `${Math.round(next.top)}:${Math.round(next.left)}:${Math.round(next.width)}:${Math.round(next.height)}`
        : "";
      if (key !== last) {
        last = key;
        setRect(next);
      }
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(frame);
      setRect(null);
    };
  }, [target]);

  return target ? rect : null;
}
