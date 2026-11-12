"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { NAV_ITEMS, isActivePath } from "@/config/navigation";
import { usePlayerLevel } from "@/features/game/store";
import { isUnlocked } from "@/lib/sim/progression";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Phone navigation: five thumb-reachable tabs above the home indicator. */
export function TabBar() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const level = usePlayerLevel();

  return (
    <nav
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 z-nav border-t border-line-1 bg-surface-1/92 pb-safe backdrop-blur-lg lg:hidden"
    >
      <ul className="mx-auto flex h-(--tabbar-height) max-w-lg">
        {NAV_ITEMS.filter((item) => !item.desktopOnly).map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={t(item.key)}
                data-tour={`nav-${item.key}`}
                onClick={() => {
                  haptic("tap");
                  void playSound("tap");
                }}
                className={cn(
                  "relative flex h-full flex-col items-center justify-center gap-1 rounded-md focus-ring transition-colors duration-fast",
                  active ? "text-fg-1" : "text-fg-3",
                )}
              >
                <span className="relative grid h-8 w-12 max-w-full place-items-center">
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
                    {item.unlock && !isUnlocked(item.unlock, level) && (
                      <span className="absolute -top-0.5 -right-0.5 grid size-3.5 place-items-center rounded-xs bg-surface-3 text-fg-2">
                        <PixelIcon {...UI_ICONS.lock} scale={1} className="scale-75" />
                      </span>
                    )}
                  </motion.span>
                </span>
                {/* Short labels: seven tabs share 390 px (ADR-080). */}
                <span className="max-w-full truncate px-0.5 label-pixel text-[0.5625rem] leading-none tracking-normal">
                  {t(`short.${item.key}`)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
