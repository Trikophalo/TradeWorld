"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { NEW_FEATURES } from "@/features/home/today";
import { useSeenFeatures } from "@/features/home/seen";

/**
 * On phones the game scrolls inside #scroll-root: a new page starts at the top, like a normal page would. It also
 * remembers which features the player has opened, for "Heute dran" (ADR-102).
 */
export function ScrollReset() {
  const pathname = usePathname();
  const mark = useSeenFeatures((s) => s.mark);
  useEffect(() => {
    const feature = NEW_FEATURES.find((f) => pathname === f.href || pathname.startsWith(`${f.href}/`));
    if (feature) mark(feature.key);
    if (window.location.hash) return;
    document.getElementById("scroll-root")?.scrollTo({ top: 0 });
  }, [pathname, mark]);
  return null;
}
