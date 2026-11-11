"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { isActivePath, visibleNavItems } from "@/config/navigation";
import { useDemo } from "@/lib/demo/store";
import { haptic } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Phone navigation: five thumb-reachable tabs above the home indicator. */
export function TabBar() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const level = useDemo((state) => state.level);
  const items = visibleNavItems(level);

  return (
    <nav
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 z-nav border-t border-line-1 bg-surface-1/92 pb-safe backdrop-blur-lg lg:hidden"
    >
      <ul className="mx-auto flex h-(--tabbar-height) max-w-lg">
        {items.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                data-tour={`nav-${item.key}`}
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
