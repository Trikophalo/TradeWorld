"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** On phones the game scrolls inside #scroll-root: a new page starts at the top, like a normal page would. */
export function ScrollReset() {
  const pathname = usePathname();
  useEffect(() => {
    if (window.location.hash) return;
    document.getElementById("scroll-root")?.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}
