"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { NAV_ITEMS, isActivePath } from "@/config/navigation";
import { haptic } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Phone navigation: five thumb-reachable tabs above the home indicator. */
export function TabBar() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <nav
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 z-nav border-t border-line-1 bg-surface-1/92 pb-safe backdrop-blur-lg lg:hidden"
    >
      <ul className="mx-auto grid h-(--tabbar-height) max-w-lg grid-cols-5">
        {NAV_ITEMS.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={() => haptic("tap")}
                className={cn(
                  "relative flex h-full flex-col items-center justify-center gap-1 rounded-md focus-ring transition-colors duration-fast",
                  active ? "text-fg-1" : "text-fg-3",
                )}
              >
                <span className="relative grid h-8 w-14 place-items-center">
                  {active && (
                    <motion.span
                      layoutId="tabbar-active"
                      className="absolute inset-0 rounded-md bg-accent-soft"
                      transition={SPRING.snappy}
                    />
                  )}
                  <motion.span
                    className="relative"
                    animate={{ y: active ? -1 : 0, scale: active ? 1 : 0.92 }}
                    whileTap={{ scale: 0.84 }}
                    transition={SPRING.snappy}
                  >
                    <PixelIcon {...UI_ICONS[item.icon]} scale={2} className={cn(active && "text-accent")} />
                  </motion.span>
                </span>
                <span className="label-pixel leading-none">{t(item.key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
