"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { NAV_ITEMS, isActivePath } from "@/config/navigation";
import { useDemo } from "@/lib/demo/store";
import { SPRING } from "@/lib/motion";
import { xpForNextLevel } from "@/lib/sim/progression";
import { isDemoMode } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import { Wordmark } from "./wordmark";

/** Desktop navigation. Hidden below the `lg` breakpoint, where the tab bar takes over. */
export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations();
  const level = useDemo((state) => state.level);
  const xp = useDemo((state) => state.xpInLevel);
  const needed = xpForNextLevel(level);

  return (
    <aside className="fixed inset-y-0 left-0 z-nav hidden w-(--sidebar-width) flex-col border-r border-line-1 bg-surface-1 lg:flex">
      <Link href="/" className="mx-3 mt-4 flex h-12 items-center rounded-md px-3 focus-ring">
        <Wordmark />
        {isDemoMode && (
          <Badge tone="accent" className="ml-auto">
            {t("app.demoBadge")}
          </Badge>
        )}
      </Link>

      <nav aria-label={t("nav.label")} className="mt-6 flex flex-col gap-1 px-3">
        {NAV_ITEMS.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex h-11 items-center gap-3 rounded-md px-3 text-base font-medium focus-ring transition-colors duration-fast",
                active ? "text-fg-1" : "text-fg-2 hover:text-fg-1",
              )}
            >
              {active ? (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-md bg-surface-3"
                  transition={SPRING.snappy}
                />
              ) : (
                <span className="absolute inset-0 rounded-md bg-surface-2 opacity-0 transition-opacity duration-fast group-hover:opacity-100" />
              )}
              <PixelIcon
                {...UI_ICONS[item.icon]}
                scale={2}
                className={cn("relative transition-colors duration-fast", active && "text-accent")}
              />
              <span className="relative">{t(`nav.${item.key}`)}</span>
            </Link>
          );
        })}
      </nav>

      <Link
        href="/profile"
        className="mx-3 mt-auto mb-4 rounded-lg border border-line-1 bg-surface-2 p-3.5 focus-ring transition-colors duration-fast hover:border-line-2"
      >
        <div className="mb-2.5 flex items-baseline justify-between">
          <span className="font-pixel text-xs text-fg-1 uppercase">{t("topbar.level", { level })}</span>
          <span className="nums text-xs text-fg-3">
            {xp} / {needed} XP
          </span>
        </div>
        <Progress value={xp / needed} label={t("profile.xpLabel")} tone="accent" size="sm" />
      </Link>
    </aside>
  );
}
